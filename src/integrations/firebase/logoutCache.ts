import {
  clearIndexedDbPersistence,
  terminate,
  waitForPendingWrites,
  type Firestore,
} from "firebase/firestore";
import {
  preservedWritesLedger,
  type PreservedWritesLedger,
} from "./preservedWrites";

/**
 * Firestore offline cache vs. logout on a shared/trusted device.
 *
 * What exists today: Firestore runs on a persistent (IndexedDB) local
 * cache (see client.ts), and logout clears only the in-memory layers —
 * the adapter signs out of Auth and useAuth clears the React Query cache.
 * The previous user's documents stay in IndexedDB after logout: on a
 * shared phone the next person (or anyone with the phone) can read that
 * user's finance, health, location and SOS data straight off the disk.
 *
 * What this module does: on logout, clear that IndexedDB cache — but
 * ONLY when it is proven safe: (a) the departing user's own queue has
 * no unsynced offline writes (waitForPendingWrites, checked while
 * they are still signed in), AND (b) no EARLIER identity has
 * unresolved preserved writes recorded in the preserved-writes ledger
 * (see preservedWrites.ts: the record itself, in its own IndexedDB
 * database mirrored to localStorage). Clearing with pending writes would
 * silently destroy data the user created while offline (e.g. a
 * transaction saved with no network that has not synced yet), so
 * pending writes are always preserved and the cache is left in place.
 * The safe default on any doubt (timeout, error) is also to preserve.
 *
 * Why (b) is needed: waitForPendingWrites only sees the ACTIVE
 * identity's queue, so a clean result for the departing user proves
 * NOTHING about unsynced writes of an earlier identity still retained
 * in this cache. Round 1 fixed the departing user; without the ledger
 * gate, the NEXT user logging out with a clean queue would clear the
 * whole cache and destroy the earlier user's still-pending write.
 * An active-user clean check is NOT a whole-cache safety proof — the
 * ledger check is what makes the clear safe across logins.
 *
 * Mechanics: clearing needs terminate() first, and a terminated
 * Firestore instance cannot be used again — so after a successful clear
 * the caller MUST reload the page (module init creates a fresh
 * instance). The helper reports what happened; it never throws.
 *
 * SHARED / TRUSTED-DEVICE POLICY (explicit): on a shared device, logout
 * clears the previous user's offline cache ONLY when that user has no
 * unsynced writes AND no earlier identity has unresolved preserved
 * writes. If writes are pending (offline), the cache is KEPT — privacy
 * yields to data safety, because clearing would destroy data the user
 * created offline. The data stays on the device until the user is back
 * online and logs out again after it syncs. The caller (signOutFlow)
 * is responsible for checking BEFORE Auth sign-out changes the identity:
 * waitForPendingWrites only sees the active identity's queue, so a
 * check after sign-out would see the next identity's empty queue and
 * report "clean" while the departing user's writes are still pending.
 * This helper alone cannot know which identity is departing — it trusts
 * the caller to pass departingUid, and records/resolves that identity
 * in the ledger itself.
 *
 * Known limits (by design, not bugs):
 * - If another tab holds the database open (web multi-tab manager),
 *   terminate/clear can fail — the cache is then kept and logout still
 *   succeeds. The failure is reported, not fatal.
 * - The ledger only records identities whose logout went through this
 *   flow. A session that ends without this logout path (e.g. a token
 *   revoked while offline) leaves no record, so a later clear cannot
 *   be proven safe for that identity's writes. Do not claim otherwise.
 * - Local-only stores are out of scope here: chat history (localStorage,
 *   24 h prune), routine reminders and other device-local state are
 *   untouched by this change.
 */

export type LogoutCacheReason =
  | "cleared"
  | "pending-writes-preserved"
  | "clear-failed";

export type LogoutCacheResult = {
  cleared: boolean;
  reason: LogoutCacheReason;
  /** Human-readable detail for logs; never contains user data. */
  detail?: string;
  /**
   * True when the Firestore instance was terminated (terminate() was
   * attempted) but the cache was NOT cleared — i.e. reason
   * "clear-failed". The client is dead in that state: the next read
   * throws "client already terminated". The caller MUST reinitialize
   * the client (reinitializeFirestore) before using Firestore again;
   * the data itself is still in IndexedDB, so reinit discards nothing.
   * Absent/false on every other outcome (pending-writes-preserved
   * never terminates; "cleared" is followed by a page reload).
   */
  terminated?: boolean;
};

/** Firestore SDK calls used here, injectable so tests need no SDK/emulator. */
export type FirestoreCacheApi = {
  waitForPendingWrites: (db: Firestore) => Promise<void>;
  terminate: (db: Firestore) => Promise<void>;
  clearIndexedDbPersistence: (db: Firestore) => Promise<void>;
};

const defaultApi: FirestoreCacheApi = {
  waitForPendingWrites,
  terminate,
  clearIndexedDbPersistence,
};

const DEFAULT_PENDING_WRITES_TIMEOUT_MS = 2000;

function sleep(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms);
  });
}

/**
 * True when Firestore reports no unsynced writes within the timeout.
 * waitForPendingWrites() resolves immediately when there is nothing
 * pending; while offline with pending writes it never resolves, so the
 * timeout fires and we treat the state as "not clean" (preserve).
 * A rejection is also treated as "not clean" — never clear on doubt.
 */
export async function hasNoPendingWrites(
  db: Firestore,
  timeoutMs: number = DEFAULT_PENDING_WRITES_TIMEOUT_MS,
  api: FirestoreCacheApi = defaultApi,
): Promise<boolean> {
  const settled = await Promise.race([
    api.waitForPendingWrites(db).then(
      () => "clean" as const,
      () => "error" as const,
    ),
    sleep(timeoutMs),
  ]);
  return settled === "clean";
}

/**
 * Clear the Firestore persistent cache for a logout, preserving any
 * pending offline writes. Returns whether the cache was cleared.
 * Never throws: every failure path returns a result instead.
 *
 * Safety is TWO checks, not one: the departing user's own queue must
 * be clean (waitForPendingWrites, while they are still signed in)
 * AND the preserved-writes ledger must hold no unresolved entry for
 * any earlier identity. A clean active queue alone never authorises
 * a whole-cache clear.
 */
export async function clearFirestoreCacheOnLogout(
  db: Firestore,
  opts: {
    timeoutMs?: number;
    api?: FirestoreCacheApi;
    preservedWrites?: PreservedWritesLedger;
    departingUid?: string | null;
  } = {},
): Promise<LogoutCacheResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PENDING_WRITES_TIMEOUT_MS;
  const api = opts.api ?? defaultApi;
  const ledger = opts.preservedWrites ?? preservedWritesLedger;
  const departingUid = opts.departingUid ?? null;

  if (!(await hasNoPendingWrites(db, timeoutMs, api))) {
    // Record the departing identity, so a LATER logout by another
    // identity cannot clear the cache while these writes are still
    // pending. Without this record the next user's clean check would
    // authorise a clear that destroys them. record() reports whether
    // the record landed durably — a false return is surfaced in the
    // detail (not swallowed): the CURRENT logout still preserves the
    // cache, but no durable proof exists for a later logout, so the
    // failure must be visible in logs.
    let recorded = true;
    if (departingUid) recorded = await ledger.record(departingUid);
    return {
      cleared: false,
      reason: "pending-writes-preserved",
      detail:
        "Pending offline writes may exist (or the sync check timed out); cache kept so no unsynced data is lost." +
        (recorded
          ? ""
          : " WARNING: the preserved-writes record could not be written durably, so a later logout cannot be proven unsafe from the ledger alone."),
    };
  }

  // The departing user's own queue just proved clean. If they had an
  // entry from an earlier logout, it is stale now — resolve it before
  // checking what remains, so their own old entry cannot block a
  // clear that is now safe for them.
  if (departingUid) await ledger.resolve(departingUid);

  // waitForPendingWrites only sees the ACTIVE identity's queue: the
  // clean result above proves nothing about unsynced writes of an
  // EARLIER identity still retained in this cache. The ledger is the
  // only record of those — if any entry is unresolved, a whole-cache
  // clear would destroy that identity's pending writes, so keep the
  // cache instead. The data stays until that identity returns, syncs,
  // and logs out clean.
  if (await ledger.hasUnresolved()) {
    return {
      cleared: false,
      reason: "pending-writes-preserved",
      detail:
        "Unsynced writes of an earlier signed-in user may still be in the cache (recorded when their logout preserved them); cache kept so no unsynced data is lost.",
    };
  }

  // terminate() can fail if the instance is already terminated; that is
  // fine — the clear is attempted anyway and decides the outcome.
  // Either way the instance is dead from here on (a successful terminate,
  // or one that failed because it was already terminated), so a failed
  // clear below must report terminated: true — the caller has to
  // reinitialize the client instead of leaving a dead one behind.
  try {
    await api.terminate(db);
  } catch (e) {
    console.warn("Firestore terminate before cache clear failed", e);
  }

  try {
    await api.clearIndexedDbPersistence(db);
  } catch (e) {
    return {
      cleared: false,
      reason: "clear-failed",
      detail: `clearIndexedDbPersistence failed: ${e instanceof Error ? e.message : String(e)}`,
      terminated: true,
    };
  }

  return { cleared: true, reason: "cleared" };
}
