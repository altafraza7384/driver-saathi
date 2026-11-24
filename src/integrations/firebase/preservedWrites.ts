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
 * STORAGE (round 3, round 5): the ledger record itself lives in its OWN
 * IndexedDB database ("driver-saathi-preserved-writes"), NOT in
 * localStorage and NOT in Firestore's IndexedDB store. That database
 * survives clearIndexedDbPersistence (which wipes only Firestore's
 * store), survives a page reload and a fresh client, and has its own
 * quota — independent of localStorage. The same record is ALSO
 * mirrored to localStorage, and (round 5) to a first-party cookie:
 * if any store's write fails, the record still lands durably in the
 * others, and a later logout reads the union of all three. The
 * effective ledger is the union; if ANY store cannot be read,
 * hasUnresolved() fails closed (never clear on doubt). The cookie is
 * synchronous (document.cookie) and independent of both IndexedDB and
 * localStorage, so it is the store that survives the transient
 * failure of the other two — see the healed-window note below.
 *
 * WHY NOT A FLAG: after a write fails, no sentinel, marker, or
 * in-memory flag is treated as proof of anything. The ONLY thing that
 * blocks a later clear is the ledger record itself, written durably
 * (in at least one store). A flag cannot name the owning identity and
 * cannot be resolved by that identity returning and logging out clean;
 * the record can. The cookie holds the SAME record (the uid list),
 * not a flag — it is a third mirror of the record, not a substitute
 * for it. record() therefore reports whether it landed durably
 * (true) or not (false) instead of swallowing the failure — a failed
 * record is visible to the caller, never silent.
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
 * HEALED-WINDOW HOLE — CLOSED (round 5): the round-4 residual was
 * the transient window: a record lost while ALL ledger stores were
 * down, where the stores recover before the next logout. Then the
 * liveness probe passed, the ledger read empty, and the clear could
 * not be proven unsafe. That window is closed by the cookie mirror:
 * the record now has to fail in THREE independent stores at once to
 * be lost, and the cookie is the store that keeps working when
 * IndexedDB and localStorage transiently refuse writes (it is
 * synchronous and on a separate storage path). A fresh client after
 * the heal reads the cookie and refuses the clear. The regressions
 * prove it: both stores fail at A's record and recover before B's
 * logout → cleared=false, no terminate/clear calls, A's record
 * survives. The cookie channel is itself proven live at clear time
 * (verifyLive probes it: a disabled cookie jar reads empty without
 * throwing, so its emptiness alone is never trusted).
 *
 * REMAINING RESIDUALS (exact, round 5 — do not claim more):
 * (1) A record is lost only if ALL THREE stores fail at record time
 * AND the cookie is then deleted before the next logout while the
 * other two recover. Normal site-data clearing wipes the Firestore
 * cache too, so there is nothing left to protect in that case; only
 * a targeted deletion of this one cookie (e.g. via devtools) while
 * the other two stores heal leaves the hole. No client-side
 * mechanism can resurrect a record that was never written anywhere.
 * (2) If the cookie channel dies AFTER holding the only copy of a
 * record, that entry stays unresolved (stuck-safe, fail-closed)
 * until the channel recovers and the owner logs out clean — the
 * cache is kept meanwhile, never cleared on doubt.
 * (3) On clients where first-party cookies are blocked, the cookie
 * probe fails and logout cache-clear is permanently refused
 * (fail-closed): the cache is kept. Privacy yields to data safety,
 * as elsewhere in this module.
 * (4) The pre-existing scope limit stands: the ledger only knows
 * about identities whose logout went through this flow.
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
   * store, false when it landed nowhere (all stores failed, or the
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
   * POSITIVE proof that the ledger channel is live (round 4b, round 5):
   * writes the current ledger content back to every store and reads
   * it back, and returns true only when the round-trip succeeds in at
   * least one store and the read-back equals what was written. An
   * empty read is trustworthy ONLY when this passes: a read of
   * null/empty from dead stores looks identical to a genuinely empty
   * ledger, and only a live round-trip tells them apart. This writes
   * NO new value, flag, or marker — it re-writes the ledger's own
   * current content (or removes the key when empty) and verifies it.
   * When a cookie store is configured it is additionally proven live
   * directly (write the ledger's own JSON encoding, require it back):
   * a disabled cookie jar reads empty WITHOUT throwing, so the union
   * round-trip alone cannot prove that channel live, and an empty
   * cookie read must never authorise a clear on its own. False when
   * the ledger is unreadable, when no store accepts the write, when
   * the read-back differs, or when the cookie probe fails. Never throws.
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
 * Cookie name for the ledger's third mirror. No `:` — a colon is a
 * cookie-name separator (RFC 6265 token), so the localStorage key
 * cannot be reused verbatim.
 */
export const PRESERVED_WRITES_COOKIE_NAME =
  "driver-saathi-preserved-pending-writes";
/** One year: the record must survive reloads and fresh clients until its owner resolves it. */
const PRESERVED_WRITES_COOKIE_MAX_AGE_SECONDS = 31536000;

/** Minimal `document.cookie` surface, injectable so tests can drive it with a fake jar. */
export type CookieJar = {
  cookie: string;
};

/**
 * The ledger's own record as a first-party cookie (round 5): a third
 * durable store, synchronous and independent of both IndexedDB and
 * localStorage. It holds the SAME record as the other mirrors — the
 * JSON array of user ids, not a flag or marker — so it names the
 * owning identity and is resolved the same way (the owner returning
 * and logging out clean). A cookie is set and read synchronously via
 * document.cookie, on a storage path no IndexedDB/localStorage
 * failure can touch.
 *
 * WHY A COOKIE, NOT A CACHE SWEEP: the alternative candidate — before
 * clearing, sweep the Firestore cache for every writable collection
 * and refuse if any cached document has metadata.hasPendingWrites —
 * cannot be the proof. A pending DELETE tombstones its document, so
 * the doc is excluded from getDocsFromCache query results, and its id
 * is not enumerable through any public Firestore API; the sweep would
 * be blind to deletes. It also cannot enumerate subcollections of
 * identities unknown to the client. The cookie instead mirrors the
 * record itself, so it covers every mutation type, including deletes.
 *
 * FAIL-OPEN READ: unlike the other stores, a cookie jar fails OPEN
 * on read — disabled/blocked cookies read empty WITHOUT throwing, so
 * an empty cookie read proves nothing on its own. Two defences:
 * (1) write() verifies its own read-back and THROWS when the value
 * did not land, so a dead channel fails loudly like the other stores
 * (record() then honestly reports that the cookie did not take it);
 * (2) verifyLive() probes the cookie channel directly (write the
 * ledger's own JSON encoding, require it back) before any clear is
 * authorised. A cookie that never lands therefore blocks the clear
 * instead of silently authorising it.
 *
 * The jar is injectable so tests can drive this store with a fake
 * cookie jar (including one that silently drops writes, modelling
 * cookies disabled). With no jar, the global document is used; when
 * there is no document at all the store cannot be created (the
 * production ledger then omits it, as it omits IndexedDB when that
 * is unavailable).
 */
export function createCookieStore(jar?: CookieJar): PreservedWritesStorage {
  const doc: CookieJar | undefined =
    jar ?? (typeof document !== "undefined" ? document : undefined);
  if (!doc) throw new Error("document.cookie is not available");

  const readRaw = (): string | null => {
    const prefix = `${PRESERVED_WRITES_COOKIE_NAME}=`;
    for (const part of doc.cookie.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        const encoded = trimmed.slice(prefix.length);
        try {
          return decodeURIComponent(encoded);
        } catch {
          // An undecodable value is corrupt, not empty: return
          // invalid JSON so the ledger fails closed.
          return "corrupt";
        }
      }
    }
    return null;
  };

  return {
    async read() {
      return readRaw();
    },
    async write(value: string) {
      doc.cookie =
        `${PRESERVED_WRITES_COOKIE_NAME}=${encodeURIComponent(value)}` +
        `; max-age=${PRESERVED_WRITES_COOKIE_MAX_AGE_SECONDS}; path=/; SameSite=Lax`;
      // A disabled/blocked jar drops the write SILENTLY (no throw),
      // so verify the read-back: a cookie that never landed must fail
      // loudly, or record() would report success for a record that
      // exists nowhere.
      if (readRaw() !== value) {
        throw new Error(
          "Cookie write could not be verified (cookies may be disabled)",
        );
      }
    },
    async remove() {
      // Absence cannot be verified (it looks identical to a dead
      // channel) — verifyLive probes the channel with a write
      // instead of trusting a remove + read.
      doc.cookie =
        `${PRESERVED_WRITES_COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax`;
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
  cookie: PreservedWritesStorage | null = null,
): PreservedWritesLedger {
  /**
   * The effective ledger is the UNION of all configured stores. Any
   * store unreadable or corrupt → null (fail closed). Every store
   * holds the same record (mirrored on write), so the union only
   * differs when a store's write failed — exactly the case the
   * mirrors exist for. The cookie is the third mirror (round 5): it
   * is what survives the other two failing at once and then healing.
   */
  const stores: { name: string; store: PreservedWritesStorage }[] = [
    { name: "primary", store: storage },
    ...(fallback ? [{ name: "mirror", store: fallback }] : []),
    ...(cookie ? [{ name: "cookie", store: cookie }] : []),
  ];

  const readUids = async (): Promise<string[] | null> => {
    try {
      const all: string[] = [];
      for (const { name, store } of stores) {
        let raw: string | null;
        try {
          raw = await store.read();
        } catch (e) {
          console.warn(
            `Preserved-writes ledger ${name} store unreadable; preserving cache`,
            e,
          );
          return null;
        }
        const uids = parseUids(raw);
        if (uids === null) return null;
        all.push(...uids);
      }
      return [...new Set(all)];
    } catch (e) {
      console.warn("Preserved-writes ledger unreadable; preserving cache", e);
      return null;
    }
  };

  /**
   * Write the full uid list to every store (best effort each).
   * Returns true when it landed durably in at least one store.
   */
  const writeUids = async (uids: string[]): Promise<boolean> => {
    let durable = false;
    for (const { name, store } of stores) {
      try {
        if (uids.length === 0) await store.remove();
        else await store.write(JSON.stringify(uids));
        durable = true;
      } catch (e) {
        console.warn(
          `Preserved-writes ledger ${name} store write failed`,
          e,
        );
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
      if (
        !(back.length === uids.length && uids.every((u) => back.includes(u)))
      )
        return false;
      // COOKIE LIVENESS (round 5): a disabled cookie jar reads empty
      // WITHOUT throwing, so the union round-trip above cannot prove
      // the cookie channel live — its emptiness alone is never proof
      // that no record exists. Prove it directly: write the ledger's
      // own JSON encoding (even when empty: "[]") to the cookie and
      // require the read-back to equal it. This writes no flag or
      // marker — it is the ledger's own content. If the probe fails,
      // the clear is refused: a record lost when the other stores
      // were down could be hiding behind the dead channel.
      if (cookie) {
        const encoded = JSON.stringify(uids);
        try {
          await cookie.write(encoded);
          const seen = await cookie.read();
          if (seen !== encoded) return false;
        } catch (e) {
          console.warn(
            "Preserved-writes ledger cookie channel could not be proven live; preserving cache",
            e,
          );
          return false;
        }
      }
      return true;
    },
  };
}

/**
 * Shared production ledger: its own IndexedDB database as primary,
 * localStorage as the mirror, and (round 5) a first-party cookie as
 * the third mirror — synchronous and independent of both, so a record
 * survives the other two failing at once and then healing. Where
 * IndexedDB does not exist (older WebViews, jsdom tests) the primary
 * is localStorage alone, as before; where there is no document (no
 * browser) the cookie mirror is omitted.
 */
const hasIndexedDb = typeof indexedDB !== "undefined";
const hasDocument = typeof document !== "undefined";
export const preservedWritesLedger: PreservedWritesLedger =
  createPreservedWritesLedger(
    hasIndexedDb ? indexedDbStore() : localStorageStore(),
    hasIndexedDb ? localStorageStore() : null,
    hasDocument ? createCookieStore() : null,
  );
