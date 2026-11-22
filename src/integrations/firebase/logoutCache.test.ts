import { describe, it, expect, vi } from "vitest";
import {
  clearFirestoreCacheOnLogout,
  hasNoPendingWrites,
  type FirestoreCacheApi,
} from "./logoutCache";
import type { Firestore } from "firebase/firestore";

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
});
