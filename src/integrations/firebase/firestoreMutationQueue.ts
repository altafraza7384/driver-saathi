/**
 * Read-only inspection of the Firestore SDK's own IndexedDB mutation
 * queue (round 6).
 *
 * THE PROBLEM IT CLOSES: the preserved-writes ledger (see
 * preservedWrites.ts) can only protect identities it managed to
 * record. When ALL THREE ledger stores fail at record time and then
 * heal — or when the record exists only in the cookie and the cookie
 * is then deleted — the ledger reads live-and-empty at the next
 * logout while user A's pending writes are still sitting in
 * Firestore's offline cache. No ledger wording can close that: a
 * record that was never written anywhere cannot be resurrected from
 * the ledger. The proof has to come from somewhere the writes
 * themselves live — and they do: every unsynced write, including
 * deletes, is a row in the Firestore SDK's own IndexedDB mutation
 * queue, held per identity until the server acknowledges it.
 *
 * WHAT IS READ (verified against the installed SDK, firebase 13.0.0
 * / @firebase/firestore 4.18.0, node_modules):
 * - Database: `firestore/<persistenceKey>/<projectId>/main`
 *   (default persistence key "[DEFAULT]", default database "(default)";
 *   a non-default database id is suffixed onto the project id as
 *   `<projectId>.<databaseId>`). This app uses the defaults — see
 *   client.ts, which calls initializeFirestore with no custom
 *   persistence key or database id.
 * - Object store `mutations`: keyPath `batchId` (autoIncrement),
 *   index `userMutationsIndex` on [userId, batchId]. Each row is one
 *   unacknowledged mutation batch: { userId, batchId, mutations }.
 *   The SDK removes the row when the batch is acknowledged, so a row
 *   present means a write is still pending for that identity.
 * - Object store `mutationQueues`: keyPath `userId`, rows shaped
 *   { userId, lastAcknowledgedBatchId, lastStreamToken }. A queue row
 *   alone (no `mutations` rows) is an EMPTY queue, not a pending
 *   write — so only the `mutations` store is counted; the
 *   `mutationQueues` store is checked only as a schema sanity signal.
 *
 * WHY THIS, NOT THE OTHER CANDIDATES:
 * - (2) A DEFERRED clear cannot close the case: deferring only helps
 *   when the ledger "cannot prove clean", but in the all-three-stores
 *   case the healed ledger DOES (falsely) prove clean — the defer
 *   condition never triggers and the clear is still authorised. The
 *   kept-cache case is also only half a fix: per-user query scoping
 *   (users/{uid}/... subcollections, adapter.collectionFor) means the
 *   kept cache is not served across users in-app, but the raw
 *   IndexedDB on disk still holds the earlier user's data, so keeping
 *   the cache forever is a privacy cost, not a solution. The
 *   inspection instead lets the clear happen SAFELY later, once the
 *   batches drain — it is the deferred clear with a real proof.
 * - A cache sweep was already ruled out in round 5 and stays ruled
 *   out: a pending DELETE tombstones its document, so the doc is
 *   excluded from getDocsFromCache results and its id is not
 *   enumerable via any public Firestore API. The inspector reads
 *   batch rows, not documents, so deletes are covered exactly like
 *   sets.
 * - waitForPendingWrites is NOT used here: the Firebase docs say it
 *   is active-user-scoped and outstanding calls are rejected on user
 *   change, so it can never see an earlier identity's queue.
 *
 * SAFETY PROPERTIES:
 * - READ-ONLY: the database is opened WITHOUT a version (never an
 *   upgrade), the transaction is "readonly", and nothing is ever
 *   written, deleted, or created. The check leaves the SDK database
 *   byte-identical (proven by the "never writes" test).
 * - FAIL-CLOSED on schema drift: the SDK is an external dependency
 *   and its internal layout can change. If the database, the stores,
 *   or the index are missing, or a batch row is malformed, the check
 *   returns "unknown" — never "clean" — and the caller refuses the
 *   clear. A future SDK upgrade that renames these stores therefore
 *   degrades to stuck-safe (clears refused until the inspector is
 *   updated), never to silent data loss.
 * - INDEPENDENT of the Firestore instance: the check reads raw
 *   IndexedDB, so it works even after terminate() and sees EVERY
 *   identity's batches, not just the active user's. It runs inside
 *   the logout write gate (signOutFlow closes the gate before the
 *   check and reopens it after), so no new write can land between
 *   the inspection and terminate()+clear.
 * - NO pending write is ever invented: "pending" requires at least
 *   one well-formed batch row with a non-empty string userId and a
 *   finite numeric batchId.
 *
 * KNOWN LIMITS (exact — do not claim more):
 * - The inspector covers only THIS app's Firestore database (default
 *   persistence key, default database, the configured project id).
 *   If the app ever uses a named database or a custom persistence
 *   key, the inspector's database name must be updated with it.
 * - Opening a database that does not exist yet CREATES an empty one
 *   (IndexedDB semantics). The inspector first asks
 *   indexedDB.databases() whether the SDK database exists at all and
 *   returns "clean" when it does not (no SDK database → no stored
 *   mutation queue → nothing pending). Where databases() is
 *   unavailable it falls back to opening: a freshly created empty
 *   database has no `mutations` store, so the check returns
 *   "unknown" and the clear is refused — fail-closed, and harmless
 *   (there is no cache to clear yet in that case).
 * - A mutation accepted into the SDK's in-memory queue but not yet
 *   flushed to IndexedDB at inspection time would be missed. For
 *   earlier identities this cannot happen (no new writes can land
 *   after their logout); for the departing user the
 *   waitForPendingWrites check in logoutCache.ts already covers the
 *   in-flight queue. The inspection is the cross-identity proof, not
 *   a replacement for that check.
 */

export type MutationQueueCheck =
  | { status: "clean" }
  | { status: "pending"; userIds: string[] }
  | { status: "unknown"; detail: string };

export type MutationQueueInspector = {
  /** Read-only: are any identities' mutation batches still pending? */
  checkPendingMutations(): Promise<MutationQueueCheck>;
};

/** Firestore SDK IndexedDB layout (installed SDK 4.18.0). */
export const FIRESTORE_SDK_MUTATIONS_STORE = "mutations";
export const FIRESTORE_SDK_MUTATION_QUEUES_STORE = "mutationQueues";
export const FIRESTORE_SDK_USER_MUTATIONS_INDEX = "userMutationsIndex";
export const FIRESTORE_SDK_DB_SUFFIX = "main";
export const DEFAULT_FIRESTORE_PERSISTENCE_KEY = "[DEFAULT]";
export const DEFAULT_FIRESTORE_DATABASE_ID = "(default)";

/**
 * The IndexedDB database name the SDK opens:
 * `firestore/<persistenceKey>/<projectId>/main`, with a non-default
 * database id suffixed onto the project id.
 */
export function firestoreSdkDbName(
  projectId: string,
  persistenceKey: string = DEFAULT_FIRESTORE_PERSISTENCE_KEY,
  databaseId: string = DEFAULT_FIRESTORE_DATABASE_ID,
): string {
  const project =
    databaseId && databaseId !== DEFAULT_FIRESTORE_DATABASE_ID
      ? `${projectId}.${databaseId}`
      : projectId;
  return `firestore/${persistenceKey}/${project}/${FIRESTORE_SDK_DB_SUFFIX}`;
}

export type FirestoreMutationQueueInspectorOptions = {
  projectId: string;
  persistenceKey?: string;
  databaseId?: string;
  /** Injectable so tests can drive it with a fake IndexedDB. */
  factory?: IDBFactory;
  timeoutMs?: number;
};

const DEFAULT_INSPECT_TIMEOUT_MS = 2000;

function unknown(detail: string): MutationQueueCheck {
  return { status: "unknown", detail };
}

export function createFirestoreMutationQueueInspector(
  options: FirestoreMutationQueueInspectorOptions,
): MutationQueueInspector {
  const projectId = options.projectId;
  const persistenceKey =
    options.persistenceKey ?? DEFAULT_FIRESTORE_PERSISTENCE_KEY;
  const databaseId = options.databaseId ?? DEFAULT_FIRESTORE_DATABASE_ID;
  const timeoutMs = options.timeoutMs ?? DEFAULT_INSPECT_TIMEOUT_MS;
  const dbName = firestoreSdkDbName(projectId, persistenceKey, databaseId);

  /** Open the SDK database WITHOUT a version: never an upgrade. */
  const openDb = (idb: IDBFactory): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Timed out opening the Firestore SDK database"));
        }
      }, timeoutMs);
      let request: IDBOpenDBRequest;
      try {
        request = idb.open(dbName);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      request.onsuccess = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(request.error ?? new Error("IndexedDB open failed"));
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("IndexedDB open blocked"));
      };
    });

  /**
   * Read the distinct userIds with unacknowledged batches, or null
   * when the queue cannot be proven either way (fail closed).
   * Read-only transaction; resolves on transaction completion.
   */
  const readPendingUserIds = (db: IDBDatabase): Promise<string[] | null> =>
    new Promise((resolve) => {
      let settled = false;
      const done = (value: string[] | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      let tx: IDBTransaction;
      try {
        tx = db.transaction(FIRESTORE_SDK_MUTATIONS_STORE, "readonly");
      } catch {
        clearTimeout(timer);
        done(null);
        return;
      }
      let request: IDBRequest<unknown[]>;
      try {
        const store = tx.objectStore(FIRESTORE_SDK_MUTATIONS_STORE);
        // The index must exist: its absence means the schema is not
        // the one this inspector was verified against — fail closed
        // instead of trusting a read from an unknown layout.
        store.index(FIRESTORE_SDK_USER_MUTATIONS_INDEX);
        request = store.getAll() as IDBRequest<unknown[]>;
      } catch {
        clearTimeout(timer);
        done(null);
        return;
      }
      let result: unknown;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => {
        clearTimeout(timer);
        done(null);
      };
      tx.oncomplete = () => {
        clearTimeout(timer);
        if (!Array.isArray(result)) {
          done(null);
          return;
        }
        const userIds: string[] = [];
        for (const entry of result) {
          if (typeof entry !== "object" || entry === null) {
            done(null);
            return;
          }
          const { userId, batchId } = entry as Record<string, unknown>;
          // A row we cannot attribute cannot be proven absent.
          if (
            typeof userId !== "string" ||
            userId.length === 0 ||
            typeof batchId !== "number" ||
            !Number.isFinite(batchId)
          ) {
            done(null);
            return;
          }
          if (!userIds.includes(userId)) userIds.push(userId);
        }
        done(userIds);
      };
      tx.onerror = () => {
        clearTimeout(timer);
        done(null);
      };
      tx.onabort = () => {
        clearTimeout(timer);
        done(null);
      };
    });

  return {
    async checkPendingMutations(): Promise<MutationQueueCheck> {
      if (!projectId) {
        return unknown(
          "No Firebase project id is configured, so the Firestore SDK database cannot be located",
        );
      }
      const idb =
        options.factory ??
        (typeof indexedDB !== "undefined" ? indexedDB : undefined);
      if (!idb) {
        return unknown("IndexedDB is not available");
      }

      // No SDK database in this profile at all → no stored mutation
      // queue can exist → nothing pending. Where databases() is
      // unavailable, fall through to the open attempt (which fails
      // closed on the missing stores of a freshly created empty DB).
      if (typeof idb.databases === "function") {
        try {
          const list = await idb.databases();
          if (
            Array.isArray(list) &&
            !list.some((d) => d && d.name === dbName)
          ) {
            return { status: "clean" };
          }
        } catch {
          // Fall through to opening the database.
        }
      }

      let db: IDBDatabase;
      try {
        db = await openDb(idb);
      } catch (e) {
        return unknown(
          `Could not open the Firestore SDK database: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      try {
        if (
          !db.objectStoreNames.contains(FIRESTORE_SDK_MUTATIONS_STORE) ||
          !db.objectStoreNames.contains(FIRESTORE_SDK_MUTATION_QUEUES_STORE)
        ) {
          return unknown(
            "The Firestore SDK database does not have the expected mutation-queue stores (schema mismatch)",
          );
        }
        const userIds = await readPendingUserIds(db);
        if (userIds === null) {
          return unknown(
            "The Firestore SDK mutation queue could not be read",
          );
        }
        return userIds.length === 0
          ? { status: "clean" }
          : { status: "pending", userIds };
      } finally {
        try {
          db.close();
        } catch {
          // Closing is best effort; the check already settled.
        }
      }
    },
  };
}

/**
 * The production inspector: this app's project id (same
 * VITE_FIREBASE_PROJECT_ID client.ts reads), default persistence key
 * and default database. A missing project id yields an inspector
 * that reports "unknown" — the caller then refuses the clear.
 */
export function createDefaultMutationQueueInspector(): MutationQueueInspector {
  const projectId =
    (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) ?? "";
  return createFirestoreMutationQueueInspector({ projectId });
}
