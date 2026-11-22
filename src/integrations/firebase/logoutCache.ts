import {
  clearIndexedDbPersistence,
  terminate,
  waitForPendingWrites,
  type Firestore,
} from "firebase/firestore";

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
 * ONLY when there are no unsynced offline writes. Clearing with pending
 * writes would silently destroy data the user created while offline
 * (e.g. a transaction saved with no network that has not synced yet),
 * so pending writes are always preserved and the cache is left in place.
 * The safe default on any doubt (timeout, error) is also to preserve.
 *
 * Mechanics: clearing needs terminate() first, and a terminated
 * Firestore instance cannot be used again — so after a successful clear
 * the caller MUST reload the page (module init creates a fresh
 * instance). The helper reports what happened; it never throws.
 *
 * SHARED / TRUSTED-DEVICE POLICY (explicit): on a shared device, logout
 * clears the previous user's offline cache ONLY when that user has no
 * unsynced writes. If writes are pending (offline), the cache is KEPT —
 * privacy yields to data safety, because clearing would destroy data the
 * user created offline. The data stays on the device until the user is
 * back online and logs out again after it syncs. The caller (signOutFlow)
 * is responsible for checking BEFORE Auth sign-out changes the identity:
 * waitForPendingWrites only sees the active identity's queue, so a
 * check after sign-out would see the next identity's empty queue and
 * report "clean" while the departing user's writes are still pending.
 * This helper alone cannot know which identity is departing — it trusts
 * the caller to call it while the departing user is still signed in.
 *
 * Known limits (by design, not bugs):
 * - If another tab holds the database open (web multi-tab manager),
 *   terminate/clear can fail — the cache is then kept and logout still
 *   succeeds. The failure is reported, not fatal.
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
 */
export async function clearFirestoreCacheOnLogout(
  db: Firestore,
  opts: { timeoutMs?: number; api?: FirestoreCacheApi } = {},
): Promise<LogoutCacheResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PENDING_WRITES_TIMEOUT_MS;
  const api = opts.api ?? defaultApi;

  if (!(await hasNoPendingWrites(db, timeoutMs, api))) {
    return {
      cleared: false,
      reason: "pending-writes-preserved",
      detail:
        "Pending offline writes may exist (or the sync check timed out); cache kept so no unsynced data is lost.",
    };
  }

  // terminate() can fail if the instance is already terminated; that is
  // fine — the clear is attempted anyway and decides the outcome.
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
    };
  }

  return { cleared: true, reason: "cleared" };
}
