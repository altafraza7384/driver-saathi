/**
 * Sign-out orchestration (extracted from useAuth.signOut so the ordering
 * is testable without rendering React).
 *
 * ORDERING — this is the whole point (PR #30 fix 1):
 * 1. Cancel in-flight queries first, so a fetch started under the old
 *    account cannot resolve after the clear and write stale data back.
 * 2. Close the logout write gate, so no NEW write can land between the
 *    pending-writes check and terminate()+clear (a write landing there
 *    would be silently destroyed by the clear; the adapter rejects it
 *    instead, with a retryable error).
 * 3. WHILE STILL SIGNED IN as the departing user, check for pending
 *    writes and clear the offline cache if clean. waitForPendingWrites
 *    only sees the ACTIVE identity's queue: checking after Auth sign-out
 *    sees the next (empty) identity's queue and reports "clean" while
 *    the departing user's offline writes are still unsynced — the old
 *    order destroyed those writes. Checking first preserves them.
 *    A clean check for the departing user is still NOT a whole-cache
 *    safety proof: unsynced writes of an EARLIER identity may still
 *    sit in this retained cache (round 2). The clear is therefore
 *    also gated on the preserved-writes ledger — the helper records
 *    the departing user when their writes are pending, resolves them
 *    when their queue proves clean, and refuses the clear while any
 *    earlier identity's entry is unresolved — AND on the ledger
 *    channel proving live (round 4b): an empty ledger read from dead
 *    stores is not positive proof that no pending writes exist, so
 *    the clear is refused while the ledger cannot round-trip its own
 *    content. The flow passes departingUid so the helper can
 *    attribute the record — AND (round 6) on the Firestore SDK's own
 *    mutation queue holding no unacknowledged batch for any identity:
 *    a live empty ledger still cannot prove a record was never LOST
 *    (all three stores failing at record time, or a cookie-only
 *    record deleted), so the SDK queue itself is inspected read-only.
 * 4. Reopen the write gate (finally — the window is over either way).
 * 5. THEN sign out of Auth. Only now does the identity change.
 * 6. Reload ONLY once signed out: the clear terminates the Firestore
 *    instance, so the page needs a fresh one — but a reload while still
 *    signed in would bring the user straight back in. If the cache was
 *    cleared but sign-out failed, reinitialize the client instead so the
 *    app stays usable (server data re-syncs) and logout can be retried.
 *
 * SHARED / TRUSTED-DEVICE POLICY (explicit): on a shared device, logout
 * clears the previous user's offline cache ONLY when that user has no
 * unsynced writes AND no earlier identity has unresolved preserved
 * writes (preserved-writes ledger, round 2). If writes are pending
 * (offline), the cache is KEPT — privacy yields to data safety, because
 * clearing would destroy data the user created offline. The data stays
 * on the device until the user is back online and logs out again after
 * it syncs. The kept-cache case is logged (onCacheKept); there is no
 * silent loss either way.
 */
import {
  clearFirestoreCacheOnLogout,
  type FirestoreCacheApi,
  type LogoutCacheResult,
} from "./logoutCache";
import type { PreservedWritesLedger } from "./preservedWrites";
import type { MutationQueueInspector } from "./firestoreMutationQueue";
import {
  closeLogoutWriteGate,
  openLogoutWriteGate,
  reinitializeFirestore,
} from "./client";
import type { Firestore } from "firebase/firestore";

export type SignOutFlowDeps = {
  /** Firestore cache step. Null/omitted on non-Firebase backends. */
  firestore?: {
    db: Firestore;
    api?: FirestoreCacheApi;
    timeoutMs?: number;
    /**
     * Uid of the departing user, for the preserved-writes ledger:
     * recorded when their writes are pending, resolved when their
     * queue proves clean. Null/omitted when unknown — the ledger
     * check for OTHER identities still applies, and nothing is
     * recorded for this logout.
     */
    departingUid?: string | null;
    /** Ledger override (tests); defaults to the shared localStorage ledger. */
    preservedWrites?: PreservedWritesLedger;
    /**
     * Mutation-queue inspector override (tests); defaults to the
     * production inspector for this app's Firebase project. The
     * inspector is what closes the all-three-stores case: it reads
     * the SDK's own mutation queue directly, so a ledger record lost
     * when every store failed cannot authorise a clear.
     */
    mutationQueue?: MutationQueueInspector | null;
  } | null;
  /** Auth sign-out (full). Must run AFTER the cache step. */
  signOutAuth: () => Promise<void>;
  /** Local-only sign-out fallback when the full sign-out throws. */
  signOutAuthLocal: () => Promise<void>;
  cancelQueries: () => void;
  clearQueries: () => void;
  closeWriteGate?: () => void;
  openWriteGate?: () => void;
  reinitializeFirestore?: () => void;
  reload?: () => void;
  onCacheKept?: (result: LogoutCacheResult) => void;
};

export type SignOutFlowResult = {
  cache: LogoutCacheResult | null;
  signedOut: boolean;
  reloaded: boolean;
  reinitialized: boolean;
};

export async function performSignOut(
  deps: SignOutFlowDeps,
): Promise<SignOutFlowResult> {
  const closeGate = deps.closeWriteGate ?? closeLogoutWriteGate;
  const openGate = deps.openWriteGate ?? openLogoutWriteGate;
  const reinit = deps.reinitializeFirestore ?? reinitializeFirestore;
  const reload = deps.reload ?? (() => window.location.reload());

  // 1. Stop in-flight reads before anything else.
  deps.cancelQueries();
  deps.clearQueries();

  // 2–4. Cache step while still signed in as the departing user.
  let cache: LogoutCacheResult | null = null;
  let reinitialized = false;
  if (deps.firestore) {
    closeGate();
    try {
      cache = await clearFirestoreCacheOnLogout(deps.firestore.db, {
        timeoutMs: deps.firestore.timeoutMs,
        api: deps.firestore.api,
        preservedWrites: deps.firestore.preservedWrites,
        departingUid: deps.firestore.departingUid,
        mutationQueue: deps.firestore.mutationQueue,
      });
    } finally {
      openGate();
    }
    if (!cache.cleared) deps.onCacheKept?.(cache);

    // Fix 2: terminate() succeeded but the clear failed — the instance
    // is dead (cache.terminated) and the next read would throw "client
    // already terminated". Reinitialize NOW, before Auth sign-out and
    // before any post-logout read. The pending data is still in
    // IndexedDB — reinit does NOT discard it; the new client resumes
    // syncing it.
    if (!cache.cleared && cache.terminated) {
      try {
        reinit();
        reinitialized = true;
      } catch (e) {
        console.warn(
          "Firestore reinit after failed cache clear failed",
          e,
        );
      }
    }
  }

  // 5. NOW sign out of Auth — only after the departing user's writes
  //    were handled.
  let signedOut = false;
  try {
    await deps.signOutAuth();
    signedOut = true;
  } catch (error) {
    console.error("Sign out failed, clearing local session", error);
    try {
      await deps.signOutAuthLocal();
      signedOut = true;
    } catch (e2) {
      console.error("Local sign out also failed", e2);
    }
  }

  // 6. Reload only once signed out (a reload while still signed in
  //    would bring the user straight back in). If the cache was cleared
  //    but sign-out failed, restore a usable client instead.
  let reloaded = false;
  if (cache?.cleared && signedOut) {
    reload();
    reloaded = true;
  } else if (cache?.cleared && !signedOut) {
    try {
      reinit();
      reinitialized = true;
    } catch (e) {
      console.warn("Firestore reinit after failed sign-out failed", e);
    }
  }
  return { cache, signedOut, reloaded, reinitialized };
}
