import { describe, it, expect, vi } from "vitest";
import {
  clearFirestoreCacheOnLogout,
  hasNoPendingWrites,
  type FirestoreCacheApi,
} from "./logoutCache";
import {
  createPreservedWritesLedger,
  type PreservedWritesLedger,
  type PreservedWritesStorage,
} from "./preservedWrites";
import type { Firestore } from "firebase/firestore";

/** Ledger over an in-memory store, so helper tests never touch localStorage. */
function memoryLedger(): PreservedWritesLedger {
  let value: string | null = null;
  return createPreservedWritesLedger({
    read: async () => value,
    write: async (v: string) => {
      value = v;
    },
    remove: async () => {
      value = null;
    },
  });
}

/** In-memory store shared across ledger instances (a "reload"). */
function memoryAsyncStore(initial?: string | null): {
  store: PreservedWritesStorage;
  get raw(): string | null;
} {
  let value: string | null = initial ?? null;
  return {
    store: {
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
  };
}

/**
 * Write-only failure (round 3): READ returns null but WRITE throws
 * (localStorage quota/error). The finding: the old ledger swallowed
 * the failed record, so a later clean logout cleared the cache.
 */
function failingAsyncStore(): PreservedWritesStorage {
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

const fakeDb = {} as Firestore;

function apiWith(overrides: Partial<FirestoreCacheApi>): {
  api: FirestoreCacheApi;
  calls: string[];
} {
  const calls: string[] = [];
  // Every call is recorded by the wrapper, so overrides only define
  // behaviour (resolve / reject / never settle) and never push manually.
  const wrap = (
    name: keyof FirestoreCacheApi,
    impl: (db: Firestore) => Promise<void>,
  ) =>
    vi.fn(async (db: Firestore) => {
      calls.push(name);
      return impl(db);
    });
  const api: FirestoreCacheApi = {
    waitForPendingWrites: wrap("waitForPendingWrites", async () => {}),
    terminate: wrap("terminate", async () => {}),
    clearIndexedDbPersistence: wrap("clearIndexedDbPersistence", async () => {}),
  };
  for (const [key, impl] of Object.entries(overrides)) {
    (api as Record<string, unknown>)[key] = wrap(
      key as keyof FirestoreCacheApi,
      impl as (db: Firestore) => Promise<void>,
    );
  }
  return { api, calls };
}

describe("hasNoPendingWrites", () => {
  it("is true when waitForPendingWrites resolves", async () => {
    const { api } = apiWith({});
    expect(await hasNoPendingWrites(fakeDb, 50, api)).toBe(true);
  });

  it("is false when waitForPendingWrites rejects (never clear on doubt)", async () => {
    const { api } = apiWith({
      waitForPendingWrites: vi.fn(async () => {
        throw new Error("terminated");
      }),
    });
    expect(await hasNoPendingWrites(fakeDb, 50, api)).toBe(false);
  });

  it("is false when waitForPendingWrites never settles (offline pending writes)", async () => {
    const { api } = apiWith({
      waitForPendingWrites: () => new Promise<void>(() => {}),
    });
    expect(await hasNoPendingWrites(fakeDb, 10, api)).toBe(false);
  });
});

describe("clearFirestoreCacheOnLogout", () => {
  it("clears the cache when there are no pending writes", async () => {
    const { api, calls } = apiWith({});
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
    });
    expect(result).toEqual({ cleared: true, reason: "cleared" });
    expect(calls).toEqual([
      "waitForPendingWrites",
      "terminate",
      "clearIndexedDbPersistence",
    ]);
  });

  it("preserves pending writes: never calls terminate or clear", async () => {
    const { api, calls } = apiWith({
      waitForPendingWrites: () => new Promise<void>(() => {}),
    });
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 10,
      api,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-writes-preserved");
    expect(calls).toEqual(["waitForPendingWrites"]);
  });

  it("preserves the cache when the pending-writes check rejects", async () => {
    const { api, calls } = apiWith({
      waitForPendingWrites: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-writes-preserved");
    expect(calls).toEqual(["waitForPendingWrites"]);
  });

  it("still attempts the clear when terminate fails (already terminated)", async () => {
    const { api, calls } = apiWith({
      terminate: async () => {
        throw new Error("already terminated");
      },
    });
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
    });
    expect(result).toEqual({ cleared: true, reason: "cleared" });
    expect(calls).toEqual([
      "waitForPendingWrites",
      "terminate",
      "clearIndexedDbPersistence",
    ]);
  });

  it("reports clear-failed when clearIndexedDbPersistence fails (e.g. another tab holds the DB)", async () => {
    const { api, calls } = apiWith({
      clearIndexedDbPersistence: async () => {
        throw new Error("failed-precondition");
      },
    });
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("clear-failed");
    expect(result.detail).toContain("failed-precondition");
    expect(calls).toEqual([
      "waitForPendingWrites",
      "terminate",
      "clearIndexedDbPersistence",
    ]);
  });

  it("marks the client terminated when the clear fails after terminate (fix 2)", async () => {
    // terminate() succeeded, so the instance is dead even though the
    // clear failed — the caller must reinitialize before the next read,
    // or it gets "client already terminated". The flag is what tells it.
    const { api } = apiWith({
      clearIndexedDbPersistence: async () => {
        throw new Error("failed-precondition");
      },
    });
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
    });
    expect(result).toEqual({
      cleared: false,
      reason: "clear-failed",
      detail: expect.stringContaining("failed-precondition"),
      terminated: true,
    });
  });
});

describe("clearFirestoreCacheOnLogout — older retained identities (round 2)", () => {
  it("does NOT clear when another identity's preserved writes are unresolved, even with a clean active queue", async () => {
    const { api, calls } = apiWith({});
    const ledger = memoryLedger();
    await ledger.record("user-A"); // A logged out earlier with pending writes.
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: "user-B",
    });
    // B's own queue is clean, but the whole-cache clear would destroy
    // A's still-pending write — an active-user check is not a
    // whole-cache safety proof.
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-writes-preserved");
    expect(result.detail).toMatch(/user-A|earlier|retained/i);
    expect(calls).toEqual(["waitForPendingWrites"]);
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("clears when the only ledger entry is the departing user's own, and resolves it", async () => {
    const { api, calls } = apiWith({});
    const ledger = memoryLedger();
    await ledger.record("user-A"); // A returns and logs out again, now clean.
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: "user-A",
    });
    // A's own queue just proved clean, so A's entry is stale — the
    // clear is allowed and the entry is resolved.
    expect(result).toEqual({ cleared: true, reason: "cleared" });
    expect(calls).toEqual([
      "waitForPendingWrites",
      "terminate",
      "clearIndexedDbPersistence",
    ]);
    expect(await ledger.list()).toEqual([]);
  });

  it("records the departing user in the ledger when their own writes are pending", async () => {
    const { api, calls } = apiWith({
      waitForPendingWrites: () => new Promise<void>(() => {}),
    });
    const ledger = memoryLedger();
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 10,
      api,
      preservedWrites: ledger,
      departingUid: "user-A",
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-writes-preserved");
    expect(calls).toEqual(["waitForPendingWrites"]);
    // A later logout by another identity must see this entry.
    expect(await ledger.list()).toEqual(["user-A"]);
    expect(await ledger.hasUnresolved()).toBe(true);
  });

  it("does NOT clear when the departing identity is unknown and the ledger is non-empty", async () => {
    const { api, calls } = apiWith({});
    const ledger = memoryLedger();
    await ledger.record("user-A");
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: null,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-writes-preserved");
    expect(calls).toEqual(["waitForPendingWrites"]);
  });
});

describe("clearFirestoreCacheOnLogout — failed ledger record blocks later clears (round 3)", () => {
  it("(1) write-only storage failure: the failed record still blocks the next clear", async () => {
    // The mirror (localStorage role) refuses writes — setItem throws,
    // getItem returns null — while the primary (IndexedDB role) works.
    // This is the original finding: the old single-store ledger
    // swallowed the failed record and B's clean logout cleared.
    const { store: primary } = memoryAsyncStore();
    const ledger = createPreservedWritesLedger(primary, failingAsyncStore());
    const { api: pendingApi } = apiWith({
      waitForPendingWrites: () => new Promise<void>(() => {}),
    });
    const resultA = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 10,
      api: pendingApi,
      preservedWrites: ledger,
      departingUid: "user-A",
    });
    expect(resultA.cleared).toBe(false);
    expect(resultA.reason).toBe("pending-writes-preserved");
    // The record itself landed durably in the surviving store.
    expect(await ledger.hasUnresolved()).toBe(true);
    expect(await ledger.list()).toEqual(["user-A"]);

    // B logs out with a clean queue on the same client: still no clear.
    const { api: cleanApi } = apiWith({});
    const resultB = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: cleanApi,
      preservedWrites: ledger,
      departingUid: "user-B",
    });
    expect(resultB.cleared).toBe(false);
    expect(resultB.reason).toBe("pending-writes-preserved");
  });

  it("(2) fresh-client/reload after a failed record: still no clear", async () => {
    const failing = failingAsyncStore();
    const { store: mirror } = memoryAsyncStore();
    // The primary refuses the write at record time; the record lands
    // durably in the mirror.
    const first = createPreservedWritesLedger(failing, mirror);
    const { api: pendingApi } = apiWith({
      waitForPendingWrites: () => new Promise<void>(() => {}),
    });
    const resultA = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 10,
      api: pendingApi,
      preservedWrites: first,
      departingUid: "user-A",
    });
    expect(resultA.cleared).toBe(false);

    // Reload: a fresh ledger instance over the SAME stores. B logs
    // out clean — the whole-cache clear must still be refused: there
    // is no proof A's pending writes are safe.
    const second = createPreservedWritesLedger(failing, mirror);
    expect(await second.list()).toEqual(["user-A"]);
    const { api: cleanApi } = apiWith({});
    const resultB = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: cleanApi,
      preservedWrites: second,
      departingUid: "user-B",
    });
    expect(resultB.cleared).toBe(false);
    expect(resultB.reason).toBe("pending-writes-preserved");
  });

  it("(3) later clean-user logout: still no clear while the record is unresolved", async () => {
    // Symmetric to (1): the primary fails, the mirror holds the record.
    const { store: mirror } = memoryAsyncStore();
    const ledger = createPreservedWritesLedger(
      failingAsyncStore(),
      mirror,
    );
    const { api: pendingApi } = apiWith({
      waitForPendingWrites: () => new Promise<void>(() => {}),
    });
    const resultA = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 10,
      api: pendingApi,
      preservedWrites: ledger,
      departingUid: "user-A",
    });
    expect(resultA.cleared).toBe(false);
    expect(await ledger.hasUnresolved()).toBe(true);

    // A later logout by a clean user must NOT clear while A's entry
    // is unresolved — the active-user check is not a whole-cache proof.
    const { api: cleanApi } = apiWith({});
    const resultB = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: cleanApi,
      preservedWrites: ledger,
      departingUid: "user-B",
    });
    expect(resultB.cleared).toBe(false);
    expect(resultB.reason).toBe("pending-writes-preserved");
    expect(await ledger.list()).toEqual(["user-A"]);
  });

  it("a record that lands nowhere is reported in the result, not swallowed", async () => {
    // Both stores down at once: the current logout still preserves
    // the cache, but the detail must say the record could not be
    // written durably — the failure is visible to the caller.
    const ledger = createPreservedWritesLedger(
      failingAsyncStore(),
      failingAsyncStore(),
    );
    const { api: pendingApi } = apiWith({
      waitForPendingWrites: () => new Promise<void>(() => {}),
    });
    const resultA = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 10,
      api: pendingApi,
      preservedWrites: ledger,
      departingUid: "user-A",
    });
    expect(resultA.cleared).toBe(false);
    expect(resultA.reason).toBe("pending-writes-preserved");
    expect(resultA.detail).toMatch(/could not be written durably/);
  });
});
