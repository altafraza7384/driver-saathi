import { describe, it, expect, vi } from "vitest";
import {
  clearFirestoreCacheOnLogout,
  hasNoPendingWrites,
  type FirestoreCacheApi,
} from "./logoutCache";
import {
  createPreservedWritesLedger,
  type PreservedWritesLedger,
} from "./preservedWrites";
import type { Firestore } from "firebase/firestore";

/** Ledger over an in-memory store, so helper tests never touch localStorage. */
function memoryLedger(): PreservedWritesLedger {
  let value: string | null = null;
  return createPreservedWritesLedger({
    read: () => value,
    write: (v: string) => {
      value = v;
    },
    remove: () => {
      value = null;
    },
  });
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
    ledger.record("user-A"); // A logged out earlier with pending writes.
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
    expect(ledger.list()).toEqual(["user-A"]);
  });

  it("clears when the only ledger entry is the departing user's own, and resolves it", async () => {
    const { api, calls } = apiWith({});
    const ledger = memoryLedger();
    ledger.record("user-A"); // A returns and logs out again, now clean.
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
    expect(ledger.list()).toEqual([]);
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
    expect(ledger.list()).toEqual(["user-A"]);
    expect(ledger.hasUnresolved()).toBe(true);
  });

  it("does NOT clear when the departing identity is unknown and the ledger is non-empty", async () => {
    const { api, calls } = apiWith({});
    const ledger = memoryLedger();
    ledger.record("user-A");
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
