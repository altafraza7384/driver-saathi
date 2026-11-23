/**
 * Durable ledger of identities whose unsynced writes were preserved at
 * logout (PR #30 round 2, round 3).
 *
 * THE HOLE IT CLOSES: waitForPendingWrites only sees the ACTIVE
 * identity's queue, so it can never prove a WHOLE-cache clear safe.
 * Round 1 fixed the departing user (check before the identity change),
 * but the older retained-identity case still failed: user A logs out
 * with an offline write pending and the cache is preserved; user B
 * then logs in and out with a clean queue, and the whole-cache clear
 * destroyed A's still-pending write. An active-user clean check is
 * NOT a whole-cache safety proof.
 *
 * The ledger records, at logout time, every identity whose pending
 * writes forced the cache to be kept. A later logout — by ANY identity
 * — must not clear the cache while any ledger entry is unresolved.
 * An entry is resolved only when that identity is active again and
 * its own pending-writes check proves its queue clean (at its next
 * logout through this flow). Until then the cache is kept, however
 * many other users log in and out.
 *
 * STORAGE (round 3): the ledger record itself lives in its OWN
 * IndexedDB database ("driver-saathi-preserved-writes"), NOT in
 * localStorage and NOT in Firestore's IndexedDB store. That database
 * survives clearIndexedDbPersistence (which wipes only Firestore's
 * store), survives a page reload and a fresh client, and has its own
 * quota — independent of localStorage. The same record is ALSO
 * mirrored to localStorage: if either store's write fails, the record
 * still lands durably in the other one, and a later logout reads the
 * union of both. The effective ledger is the union; if EITHER store
 * cannot be read, hasUnresolved() fails closed (never clear on doubt).
 *
 * WHY NOT A FLAG: after a write fails, no sentinel, marker, or
 * in-memory flag is treated as proof of anything. The ONLY thing that
 * blocks a later clear is the ledger record itself, written durably
 * (in at least one store). A flag cannot name the owning identity and
 * cannot be resolved by that identity returning and logging out clean;
 * the record can. record() therefore reports whether it landed
 * durably (true) or not (false) instead of swallowing the failure —
 * a failed record is visible to the caller, never silent.
 *
 * FAIL-CLOSED: if a stored value is corrupt or a store cannot be
 * read, hasUnresolved() returns true (preserve) rather than assuming
 * the cache is safe to clear. A corrupt entry can leave the cache
 * kept until the owning identity returns and logs out clean; that
 * stuck-safe state is preferable to destroying unsynced data.
 *
 * PROVEN SCOPE (honest limit): the ledger only knows about identities
 * whose logout went through this flow. A session that ends WITHOUT
 * this logout path (e.g. a token revoked while offline) leaves no
 * record, so a later clear cannot be proven safe for that identity's
 * writes. The privacy draft states this limit; do not claim more.
 *
 * RESIDUAL LIMIT (round 3, narrowed in round 4b): if EVERY durable
 * store fails at once — the IndexedDB write AND the localStorage write
 * both throw — the record cannot be written anywhere. record() returns
 * false (the failure is visible, and the CURRENT logout still preserves
 * the cache). A later logout no longer trusts an empty ledger read on
 * its own: before clearing it must PROVE the ledger channel live
 * (verifyLive: round-trip the current content through the stores). When
 * the stores are STILL down at that later logout, the probe fails and
 * the clear is refused — the persistent-failure case is closed. What
 * remains unprovable is the transient window: a record lost while ALL
 * stores were down, where the stores recover before the next logout.
 * Then the probe passes, the ledger reads empty, and the clear cannot
 * be proven unsafe. No client-side mechanism can resurrect a record
 * that was never written anywhere — a memory-only flag dies with the
 * reload, a marker in a third store would be exactly the kind of
 * non-record proof this ledger refuses to rely on, and no public
 * Firestore API enumerates another identity's pending writes
 * (waitForPendingWrites is scoped to the ACTIVE user, per Firebase's
 * own docs), so Firestore cannot close that window either. The
 * single-store failure the regressions cover — localStorage quota/error
 * while IndexedDB works, or vice versa — is handled by the mirror, and
 * the both-stores-down case is refused while the stores stay down.
 *
 * TRANSACTION DURABILITY (round 4a): an IndexedDB write is durable
 * only when its TRANSACTION completes. A put request can report
 * success and the transaction can still abort afterwards, rolling the
 * write back — so every IndexedDB request here resolves only on
 * tx.oncomplete and rejects on tx.onabort / tx.onerror, never on
 * req.onsuccess alone.
 */

/** localStorage key. Value: JSON array of user ids. */
export const PRESERVED_WRITES_STORAGE_KEY =
  "driver-saathi:preserved-pending-writes";

/** Own IndexedDB database for the ledger (never Firestore's store). */
export const PRESERVED_WRITES_DB_NAME = "driver-saathi-preserved-writes";
const PRESERVED_WRITES_IDB_STORE = "ledger";
const PRESERVED_WRITES_IDB_KEY = "preserved-pending-writes";

/**
 * Minimal async storage surface, so tests can substitute a fake store.
 * Every method is async: the production primary is IndexedDB.
 */
export type PreservedWritesStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
};

export type PreservedWritesLedger = {
  /**
   * Record that uid's unsynced writes were preserved at logout.
   * Returns true when the record landed durably in at least one
   * store, false when it landed nowhere (both stores failed, or the
   * stored value could not be read and so was left untouched). A
   * false return is NOT silent: the caller must treat it as "no
   * durable proof exists for this identity" — the current logout
   * still preserves the cache, but a later clear cannot be proven
   * unsafe from this record.
   */
  record(uid: string): Promise<boolean>;
  /** Drop uid's entry — its queue has since been proven clean. */
  resolve(uid: string): Promise<void>;
  /**
   * True when any recorded identity OTHER than exceptUid still has
   * unconfirmed pending writes — or when the ledger cannot be read
   * (fail closed: never clear on doubt). False only when every
   * recorded entry is resolved (or there are none) AND the ledger
   * was readable.
   */
  hasUnresolved(exceptUid?: string | null): Promise<boolean>;
  /** Recorded uids (empty when unreadable — never throws). */
  list(): Promise<string[]>;
  /**
   * POSITIVE proof that the ledger channel is live (round 4b): writes
   * the current ledger content back to every store and reads it back,
   * and returns true only when the round-trip succeeds in at least one
   * store and the read-back equals what was written. An empty read is
   * trustworthy ONLY when this passes: a read of null/empty from dead
   * stores looks identical to a genuinely empty ledger, and only a
   * live round-trip tells them apart. This writes NO new value, flag,
   * or marker — it re-writes the ledger's own current content (or
   * removes the key when empty) and verifies it. False when the
   * ledger is unreadable, when no store accepts the write, or when
   * the read-back differs. Never throws.
   */
  verifyLive(): Promise<boolean>;
};

function localStorageStore(): PreservedWritesStorage {
  return {
    async read() {
      return localStorage.getItem(PRESERVED_WRITES_STORAGE_KEY);
    },
    async write(value: string) {
      localStorage.setItem(PRESERVED_WRITES_STORAGE_KEY, value);
    },
    async remove() {
      localStorage.removeItem(PRESERVED_WRITES_STORAGE_KEY);
    },
  };
}

/**
 * The ledger's own IndexedDB database. A single key holds the same
 * JSON array of user ids as the localStorage mirror. Opening the
 * database is lazy (first use) and the open promise is cached; a
 * failed open is forgotten so a later call retries instead of
 * reusing a rejected promise forever.
 *
 * A request is NOT durable until its TRANSACTION completes: a put
 * request can report success and the transaction can still abort
 * afterwards, rolling the write back (round 4a). Every request
 * therefore resolves only on tx.oncomplete and rejects on
 * tx.onabort / tx.onerror / req.onerror — never on req.onsuccess
 * alone. The factory is injectable so tests can drive this store
 * with a fake IndexedDB that models completion/abort semantics.
 */
export function createIndexedDbStore(
  factory?: IDBFactory,
): PreservedWritesStorage {
  const idb =
    factory ??
    (typeof indexedDB !== "undefined" ? indexedDB : undefined);
  if (!idb) throw new Error("IndexedDB is not available");
  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDb = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = idb.open(PRESERVED_WRITES_DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (
            !request.result.objectStoreNames.contains(
              PRESERVED_WRITES_IDB_STORE,
            )
          ) {
            request.result.createObjectStore(PRESERVED_WRITES_IDB_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          dbPromise = null;
          reject(request.error ?? new Error("IndexedDB open failed"));
        };
        request.onblocked = () => {
          dbPromise = null;
          reject(new Error("IndexedDB open blocked"));
        };
      });
    }
    return dbPromise;
  };

  const runRequest = <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> =>
    openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(PRESERVED_WRITES_IDB_STORE, mode);
          const req = fn(tx.objectStore(PRESERVED_WRITES_IDB_STORE));
          // A request's success is NOT durability: the put request can
          // succeed and the transaction can still abort afterwards,
          // rolling the write back. Resolve ONLY on tx.oncomplete and
          // reject on tx.onabort / tx.onerror / req.onerror — never on
          // req.onsuccess alone. A Promise settles on its first call,
          // so a late event after the transaction has settled cannot
          // re-settle it. req.result is read at completion time, when
          // the request has necessarily finished.
          tx.oncomplete = () => resolve(req.result);
          tx.onabort = () =>
            reject(
              tx.error ??
                req.error ??
                new Error("IndexedDB transaction aborted"),
            );
          tx.onerror = () =>
            reject(
              tx.error ??
                req.error ??
                new Error("IndexedDB transaction failed"),
            );
          req.onerror = () =>
            reject(req.error ?? new Error("IndexedDB request failed"));
        }),
    );

  return {
    async read() {
      const value = await runRequest("readonly", (store) =>
        store.get(PRESERVED_WRITES_IDB_KEY),
      );
      if (value === undefined) return null;
      // A non-string value is corrupt, not empty: return invalid JSON
      // so the ledger fails closed instead of reporting "clean".
      if (typeof value !== "string") return "corrupt";
      return value;
    },
    async write(value: string) {
      await runRequest("readwrite", (store) =>
        store.put(value, PRESERVED_WRITES_IDB_KEY),
      );
    },
    async remove() {
      await runRequest("readwrite", (store) =>
        store.delete(PRESERVED_WRITES_IDB_KEY),
      );
    },
  };
}

function indexedDbStore(): PreservedWritesStorage {
  return createIndexedDbStore();
}

function parseUids(raw: string | null): string[] | null {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const uids = parsed.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    // A well-formed value round-trips exactly; anything else is corrupt.
    if (uids.length !== parsed.length) return null;
    return uids;
  } catch {
    return null;
  }
}

export function createPreservedWritesLedger(
  storage: PreservedWritesStorage = localStorageStore(),
  fallback: PreservedWritesStorage | null = null,
): PreservedWritesLedger {
  /**
   * The effective ledger is the UNION of both stores. Either store
   * unreadable or corrupt → null (fail closed). Both stores hold the
   * same record (mirrored on write), so the union only differs when
   * one store's write failed — exactly the case the mirror exists for.
   */
  const readUids = async (): Promise<string[] | null> => {
    try {
      const primary = parseUids(await storage.read());
      if (primary === null) return null;
      if (!fallback) return primary;
      let rawFallback: string | null;
      try {
        rawFallback = await fallback.read();
      } catch (e) {
        console.warn(
          "Preserved-writes ledger mirror unreadable; preserving cache",
          e,
        );
        return null;
      }
      const mirrored = parseUids(rawFallback);
      if (mirrored === null) return null;
      return [...new Set([...primary, ...mirrored])];
    } catch (e) {
      console.warn("Preserved-writes ledger unreadable; preserving cache", e);
      return null;
    }
  };

  /**
   * Write the full uid list to both stores (best effort each).
   * Returns true when it landed durably in at least one store.
   */
  const writeUids = async (uids: string[]): Promise<boolean> => {
    let durable = false;
    try {
      if (uids.length === 0) await storage.remove();
      else await storage.write(JSON.stringify(uids));
      durable = true;
    } catch (e) {
      console.warn("Preserved-writes ledger write failed", e);
    }
    if (fallback) {
      try {
        if (uids.length === 0) await fallback.remove();
        else await fallback.write(JSON.stringify(uids));
        durable = true;
      } catch (e) {
        console.warn("Preserved-writes ledger mirror write failed", e);
      }
    }
    return durable;
  };

  return {
    async record(uid: string) {
      const uids = await readUids();
      // Unreadable ledger: do NOT overwrite it (that could drop other
      // identities' entries). The current logout already preserves the
      // cache, and hasUnresolved stays fail-closed until the owner
      // returns. Best effort only — and the false return says so.
      if (uids === null) return false;
      // Already recorded durably: nothing to write, proof already held.
      if (uids.includes(uid)) return true;
      return writeUids([...uids, uid]);
    },
    async resolve(uid: string) {
      const uids = await readUids();
      if (uids === null) return;
      if (uids.includes(uid)) {
        await writeUids(uids.filter((u) => u !== uid));
      }
    },
    async hasUnresolved(exceptUid?: string | null) {
      const uids = await readUids();
      // null = unreadable/corrupt: fail closed, never clear on doubt.
      if (uids === null) return true;
      return uids.some((u) => u !== exceptUid);
    },
    async list() {
      return (await readUids()) ?? [];
    },
    async verifyLive() {
      const uids = await readUids();
      // Unreadable/corrupt: nothing can be proven — fail closed.
      if (uids === null) return false;
      // Re-write the ledger's own current content (no new value, no
      // flag, no marker) and read it back. A store that refuses the
      // write, or a read-back that differs, means the channel cannot
      // be proven live — an empty read from such stores is not proof
      // that no record exists.
      if (!(await writeUids(uids))) return false;
      const back = await readUids();
      if (back === null) return false;
      return (
        back.length === uids.length && uids.every((u) => back.includes(u))
      );
    },
  };
}

/**
 * Shared production ledger: its own IndexedDB database as primary,
 * localStorage as the mirror. Where IndexedDB does not exist (older
 * WebViews, jsdom tests) the primary is localStorage alone, as before.
 */
const hasIndexedDb = typeof indexedDB !== "undefined";
export const preservedWritesLedger: PreservedWritesLedger =
  createPreservedWritesLedger(
    hasIndexedDb ? indexedDbStore() : localStorageStore(),
    hasIndexedDb ? localStorageStore() : null,
  );
