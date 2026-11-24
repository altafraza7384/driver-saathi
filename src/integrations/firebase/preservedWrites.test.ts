/**
 * Unit tests for the preserved-writes ledger (PR #30 round 2, round 3).
 *
 * The ledger is the durable record that makes a whole-cache clear safe
 * across logins: it remembers which identities had unsynced writes
 * preserved at logout, in its own IndexedDB database mirrored to
 * localStorage (NOT Firestore's IndexedDB store — the clear wipes
 * that, so a ledger kept there would destroy itself).
 */
import { describe, it, expect } from "vitest";
import {
  createIndexedDbStore,
  createPreservedWritesLedger,
  type PreservedWritesLedger,
  type PreservedWritesStorage,
} from "./preservedWrites";

/** In-memory stand-in for a store, shared across "reloads". */
function memoryStorage(initial?: string | null): {
  storage: PreservedWritesStorage;
  get raw(): string | null;
  set raw(v: string | null);
} {
  let value: string | null = initial ?? null;
  return {
    storage: {
      read: async () => value,
      write: async (v: string) => {
        value = v;
      },
      remove: async () => {
        value = null;
      },
    },
    get raw() {
      return value;
    },
    set raw(v: string | null) {
      value = v;
    },
  };
}

/**
 * Write-only failure (round 3): READ returns null but WRITE throws
 * (localStorage quota/error). The finding this models: the old ledger
 * swallowed the failed record, so a later clean logout cleared the
 * cache and destroyed the pending write.
 */
function failingStorage(): PreservedWritesStorage {
  return {
    read: async () => null,
    write: async () => {
      throw new Error("QuotaExceededError: setItem failed");
    },
    remove: async () => {
      throw new Error("denied");
    },
  };
}

describe("preserved-writes ledger", () => {
  it("starts empty: nothing unresolved", async () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    expect(await ledger.hasUnresolved()).toBe(false);
    expect(await ledger.list()).toEqual([]);
  });

  it("record + resolve round-trips, and resolve only drops its own uid", async () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    expect(await ledger.record("user-A")).toBe(true);
    expect(await ledger.record("user-B")).toBe(true);
    expect(await ledger.list()).toEqual(["user-A", "user-B"]);
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.hasUnresolved("user-A")).toBe(true); // B still open
    await ledger.resolve("user-A");
    expect(await ledger.list()).toEqual(["user-B"]);
    expect(await ledger.hasUnresolved("user-B")).toBe(false);
    expect(await ledger.hasUnresolved()).toBe(true);
    await ledger.resolve("user-B");
    expect(await ledger.hasUnresolved()).toBe(false);
    expect(await ledger.list()).toEqual([]);
  });

  it("record is idempotent", async () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    await ledger.record("user-A");
    await ledger.record("user-A");
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("survives a fresh ledger instance over the same store (reload)", async () => {
    const backing = memoryStorage();
    const first = createPreservedWritesLedger(backing.storage);
    await first.record("user-A");
    // A new client after a reload reads the same durable store.
    const second = createPreservedWritesLedger(backing.storage);
    expect(await second.list()).toEqual(["user-A"]);
    expect(await second.hasUnresolved()).toBe(true);
  });

  it("fail-closed: corrupt stored JSON never reports clean", async () => {
    const backing = memoryStorage("not-json{{{");
    const ledger = createPreservedWritesLedger(backing.storage);
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.list()).toEqual([]);
    // record() must NOT overwrite corrupt data and drop unknown entries.
    expect(await ledger.record("user-B")).toBe(false);
    expect(backing.raw).toBe("not-json{{{");
    expect(await ledger.hasUnresolved()).toBe(true);
  });

  it("fail-closed: unreadable storage never reports clean", async () => {
    const throwing: PreservedWritesStorage = {
      read: async () => {
        throw new Error("denied");
      },
      write: async () => {
        throw new Error("denied");
      },
      remove: async () => {
        throw new Error("denied");
      },
    };
    const ledger = createPreservedWritesLedger(throwing);
    expect(await ledger.hasUnresolved()).toBe(true);
    // Neither record nor resolve may throw; record reports the failure.
    expect(await ledger.record("user-A")).toBe(false);
    await ledger.resolve("user-A");
    expect(await ledger.hasUnresolved()).toBe(true);
  });
});

describe("preserved-writes ledger — failed record is not a safety proof (round 3)", () => {
  it("a write-only failure in one store still records durably in the other", async () => {
    // The mirror (localStorage role) refuses writes; the primary
    // (IndexedDB role) works. The record itself — not a flag, not a
    // memory marker — lands durably in the surviving store.
    const { storage: primary } = memoryStorage();
    const ledger = createPreservedWritesLedger(primary, failingStorage());
    expect(await ledger.record("user-A")).toBe(true);
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("a write-only failure in the primary still records durably in the mirror", async () => {
    const { storage: mirror } = memoryStorage();
    const ledger = createPreservedWritesLedger(failingStorage(), mirror);
    expect(await ledger.record("user-A")).toBe(true);
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("a failed record survives a fresh ledger instance over the same stores (reload)", async () => {
    const failing = failingStorage();
    const mirrorBacking = memoryStorage();
    // The primary store refuses the write at record time; the record
    // itself lands durably in the mirror. A reload creates a fresh
    // ledger instance over the SAME stores — it must still see it.
    const first = createPreservedWritesLedger(failing, mirrorBacking.storage);
    expect(await first.record("user-A")).toBe(true);
    const second = createPreservedWritesLedger(
      failing,
      mirrorBacking.storage,
    );
    expect(await second.list()).toEqual(["user-A"]);
    expect(await second.hasUnresolved()).toBe(true);
  });

  it("a failed record is visible: record() returns false when it lands nowhere", async () => {
    // Both stores down at once: the failure is REPORTED (false),
    // never swallowed. The residual limit is documented on the
    // module: with no durable trace, a fresh client after a reload
    // cannot know about this record — no memory flag or third-store
    // marker is used as a substitute proof.
    const ledger = createPreservedWritesLedger(
      failingStorage(),
      failingStorage(),
    );
    expect(await ledger.record("user-A")).toBe(false);
  });

  it("the owner returning clean resolves a mirror-recorded entry (no stuck state)", async () => {
    const { storage: mirror } = memoryStorage();
    const ledger = createPreservedWritesLedger(failingStorage(), mirror);
    await ledger.record("user-A");
    expect(await ledger.hasUnresolved()).toBe(true);
    // A returns, syncs, and logs out clean: resolve drops the entry
    // from the mirror, so a later clear is allowed again.
    await ledger.resolve("user-A");
    expect(await ledger.hasUnresolved()).toBe(false);
    expect(await ledger.list()).toEqual([]);
  });
});

describe("preserved-writes ledger — liveness proof (round 4b)", () => {
  it("verifyLive is true when the stores accept and return the ledger content", async () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage);
    expect(await ledger.verifyLive()).toBe(true);
    await ledger.record("user-A");
    // A non-empty ledger round-trips too.
    expect(await ledger.verifyLive()).toBe(true);
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("verifyLive is false when both stores refuse writes", async () => {
    // Reads return empty (readable) but no write lands: an empty read
    // from these stores proves nothing, and verifyLive must say so.
    const ledger = createPreservedWritesLedger(
      failingStorage(),
      failingStorage(),
    );
    expect(await ledger.list()).toEqual([]);
    expect(await ledger.hasUnresolved()).toBe(false);
    expect(await ledger.verifyLive()).toBe(false);
  });

  it("verifyLive is true when one store works", async () => {
    const { storage } = memoryStorage();
    const ledger = createPreservedWritesLedger(storage, failingStorage());
    expect(await ledger.verifyLive()).toBe(true);
    const other = createPreservedWritesLedger(failingStorage(), storage);
    expect(await other.verifyLive()).toBe(true);
  });

  it("verifyLive is false when the ledger is unreadable or corrupt", async () => {
    const corrupt = createPreservedWritesLedger(
      memoryStorage("not-json{{{").storage,
    );
    expect(await corrupt.verifyLive()).toBe(false);
    const throwing: PreservedWritesStorage = {
      read: async () => {
        throw new Error("denied");
      },
      write: async () => {
        throw new Error("denied");
      },
      remove: async () => {
        throw new Error("denied");
      },
    };
    expect(
      await createPreservedWritesLedger(throwing).verifyLive(),
    ).toBe(false);
  });
});

/**
 * Minimal fake IndexedDB factory with transaction completion/abort
 * semantics (round 4a). It models only what the production store
 * uses — open(), transaction(), objectStore(), get/put/delete — but
 * it models the commit boundary faithfully: a put/delete stages in
 * the transaction and lands in the committed maps ONLY when the
 * transaction completes. A request reports success first; the
 * transaction then either completes (commit) or aborts (rollback).
 * `abortNextWriteTransaction` injects an abort right after the next
 * write request succeeds, which is exactly the gap the old code had:
 * it resolved on request success and never saw the abort.
 */
const DELETED = Symbol("deleted");

type FakeDbData = {
  stores: Map<string, Map<string, unknown>>;
};

class FakeIndexedDbTransaction {
  oncomplete: ((ev: Event) => void) | null = null;
  onabort: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  error: Error | null = null;
  private staged = new Map<string, Map<string, unknown | typeof DELETED>>();
  private pending = 0;
  private settled = false;

  constructor(
    private factory: FakeIndexedDbFactory,
    private data: FakeDbData,
    private mode: IDBTransactionMode,
  ) {}

  objectStore(name: string) {
    // The store methods are arrow functions so `this` is lexically the
    // transaction (a `const tx = this` alias would trip no-this-alias).
    const store: Record<string, unknown> = {
      get: (key: string) => {
        const req: Record<string, unknown> = {
          result: undefined,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        this.pending++;
        setTimeout(() => {
          req.result = this.read(name, key);
          (req.onsuccess as ((ev: Event) => void) | null)?.(
            new Event("success"),
          );
          this.requestSettled();
        }, 0);
        return req;
      },
      put: (value: unknown, key: string) => {
        const req: Record<string, unknown> = {
          result: undefined,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        this.pending++;
        this.stage(name, key, value);
        setTimeout(() => {
          req.result = key;
          (req.onsuccess as ((ev: Event) => void) | null)?.(
            new Event("success"),
          );
          this.afterWriteRequest();
        }, 0);
        return req;
      },
      delete: (key: string) => {
        const req: Record<string, unknown> = {
          result: undefined,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        this.pending++;
        this.stage(name, key, DELETED);
        setTimeout(() => {
          req.result = undefined;
          (req.onsuccess as ((ev: Event) => void) | null)?.(
            new Event("success"),
          );
          this.afterWriteRequest();
        }, 0);
        return req;
      },
    };
    return store;
  }

  private read(name: string, key: string): unknown {
    const stagedStore = this.staged.get(name);
    if (stagedStore?.has(key)) {
      const v = stagedStore.get(key);
      return v === DELETED ? undefined : v;
    }
    return this.data.stores.get(name)?.get(key);
  }

  private stage(name: string, key: string, value: unknown | typeof DELETED) {
    let stagedStore = this.staged.get(name);
    if (!stagedStore) {
      stagedStore = new Map();
      this.staged.set(name, stagedStore);
    }
    stagedStore.set(key, value);
  }

  private requestSettled() {
    this.pending--;
    if (this.pending === 0 && !this.settled) {
      this.settled = true;
      setTimeout(() => {
        this.commit();
        this.oncomplete?.(new Event("complete"));
      }, 0);
    }
  }

  /** After a write request succeeds: abort if injected, else settle. */
  private afterWriteRequest() {
    if (this.factory.abortNextWriteTransaction) {
      this.factory.abortNextWriteTransaction = false;
      this.abort();
      return;
    }
    this.requestSettled();
  }

  abort() {
    if (this.settled) return;
    this.settled = true;
    this.staged.clear();
    this.error = new Error("Transaction aborted");
    setTimeout(() => {
      this.onabort?.(new Event("abort"));
    }, 0);
  }

  private commit() {
    for (const [name, stagedStore] of this.staged) {
      let committed = this.data.stores.get(name);
      if (!committed) {
        committed = new Map();
        this.data.stores.set(name, committed);
      }
      for (const [key, value] of stagedStore) {
        if (value === DELETED) committed.delete(key);
        else committed.set(key, value);
      }
    }
    this.staged.clear();
  }
}

class FakeIndexedDbFactory {
  private databases = new Map<string, FakeDbData>();
  /**
   * When true, the next write transaction aborts right after its
   * first put/delete request reports success. Consumed on use.
   */
  abortNextWriteTransaction = false;

  open(name: string, _version?: number) {
    const req: Record<string, unknown> = {
      result: undefined,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
    setTimeout(() => {
      let data = this.databases.get(name);
      const isNew = !data;
      if (!data) {
        data = { stores: new Map() };
        this.databases.set(name, data);
      }
      const db = this.makeDb(data);
      req.result = db;
      if (isNew) {
        (req.onupgradeneeded as ((ev: Event) => void) | null)?.(
          new Event("upgradeneeded"),
        );
      }
      (req.onsuccess as ((ev: Event) => void) | null)?.(
        new Event("success"),
      );
    }, 0);
    return req as unknown as IDBOpenDBRequest;
  }

  private makeDb(data: FakeDbData) {
    // `transaction` is an arrow function so `this` is lexically the
    // factory (a `const factory = this` alias would trip no-this-alias).
    const db: Record<string, unknown> = {
      objectStoreNames: {
        contains: (storeName: string) => data.stores.has(storeName),
      },
      createObjectStore(storeName: string) {
        if (!data.stores.has(storeName)) {
          data.stores.set(storeName, new Map());
        }
        return {};
      },
      transaction: (
        storeNames: string | string[],
        mode?: IDBTransactionMode,
      ) => {
        return new FakeIndexedDbTransaction(
          this,
          data,
          mode ?? "readonly",
        );
      },
    };
    return db as unknown as IDBDatabase;
  }
}

describe("preserved-writes ledger — IndexedDB transaction completion (round 4a)", () => {
  it("records durably when the put succeeds and the transaction completes, and survives reload", async () => {
    const idb = new FakeIndexedDbFactory();
    const store = createIndexedDbStore(idb as unknown as IDBFactory);
    const ledger = createPreservedWritesLedger(store, failingStorage());
    expect(await ledger.record("user-A")).toBe(true);
    // Reload: a fresh store + fresh ledger over the same fake database.
    const reloaded = createPreservedWritesLedger(
      createIndexedDbStore(idb as unknown as IDBFactory),
      failingStorage(),
    );
    expect(await reloaded.list()).toEqual(["user-A"]);
    expect(await reloaded.hasUnresolved()).toBe(true);
  });

  it("record() returns false when the transaction aborts right after the put succeeds (mirror also fails)", async () => {
    // REGRESSION (round 4a): the put request succeeds, then the
    // transaction aborts and rolls the write back. The old code
    // resolved on request success, so record() wrongly returned true
    // even though nothing landed — and a reload then showed an empty
    // ledger (unresolved=false) with no trace of the record.
    const idb = new FakeIndexedDbFactory();
    idb.abortNextWriteTransaction = true;
    const store = createIndexedDbStore(idb as unknown as IDBFactory);
    const ledger = createPreservedWritesLedger(store, failingStorage());
    expect(await ledger.record("user-A")).toBe(false);
    // The aborted put rolled back: a reload sees an empty ledger.
    const reloaded = createPreservedWritesLedger(
      createIndexedDbStore(idb as unknown as IDBFactory),
      failingStorage(),
    );
    expect(await reloaded.list()).toEqual([]);
    expect(await reloaded.hasUnresolved()).toBe(false);
  });

  it("an aborted IndexedDB put still records durably in the healthy mirror", async () => {
    const idb = new FakeIndexedDbFactory();
    idb.abortNextWriteTransaction = true;
    const { storage: mirror } = memoryStorage();
    const ledger = createPreservedWritesLedger(
      createIndexedDbStore(idb as unknown as IDBFactory),
      mirror,
    );
    // The IndexedDB write rolled back, but the record itself landed
    // durably in the mirror — record() honestly reports the mirror.
    expect(await ledger.record("user-A")).toBe(true);
    const reloaded = createPreservedWritesLedger(
      createIndexedDbStore(idb as unknown as IDBFactory),
      mirror,
    );
    expect(await reloaded.list()).toEqual(["user-A"]);
    expect(await reloaded.hasUnresolved()).toBe(true);
  });
});
