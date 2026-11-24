import { describe, it, expect, vi } from "vitest";
import {
  clearFirestoreCacheOnLogout,
  hasNoPendingWrites,
  type FirestoreCacheApi,
} from "./logoutCache";
import {
  createCookieStore,
  createPreservedWritesLedger,
  PRESERVED_WRITES_COOKIE_NAME,
  type PreservedWritesLedger,
  type PreservedWritesStorage,
} from "./preservedWrites";
import {
  createFirestoreMutationQueueInspector,
  type MutationQueueCheck,
  type MutationQueueInspector,
} from "./firestoreMutationQueue";
import type { Firestore } from "firebase/firestore";

/** Stub inspector: the SDK mutation queue is provably empty. */
function cleanInspector(): MutationQueueInspector {
  return {
    checkPendingMutations: async (): Promise<MutationQueueCheck> => ({
      status: "clean",
    }),
  };
}

/** Stub inspector: the SDK mutation queue still holds these uids' batches. */
function pendingInspector(userIds: string[]): MutationQueueInspector {
  return {
    checkPendingMutations: async (): Promise<MutationQueueCheck> => ({
      status: "pending",
      userIds,
    }),
  };
}

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
      mutationQueue: cleanInspector(),
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
      mutationQueue: cleanInspector(),
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
      mutationQueue: cleanInspector(),
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
      mutationQueue: cleanInspector(),
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
      mutationQueue: cleanInspector(),
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

describe("clearFirestoreCacheOnLogout — both ledger stores fail, fresh client (round 4)", () => {
  it("refuses a later clean logout on a fresh client when both ledger writes failed", async () => {
    // REGRESSION (round 4b): both ledger stores refuse writes, but
    // reads return empty (readable). A's pending writes therefore
    // leave NO durable trace — yet they are still in Firestore's
    // pending cache. A fresh client after a reload reads an empty
    // ledger, so ledger-emptiness alone must NOT authorise B's
    // whole-cache clear: a destructive clear needs POSITIVE proof
    // that no pending writes exist, and an empty read from dead
    // stores is not that proof. No real cache deletion happens in
    // this test: the refusal is asserted from the result + call list.
    const failingPrimary = failingAsyncStore();
    const failingMirror = failingAsyncStore();
    const first = createPreservedWritesLedger(
      failingPrimary,
      failingMirror,
    );
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
    expect(resultA.reason).toBe("pending-writes-preserved");
    expect(resultA.detail).toMatch(/could not be written durably/);
    // The ledger itself holds nothing after the failed record.
    expect(await first.list()).toEqual([]);
    expect(await first.hasUnresolved()).toBe(false);

    // Reload: a fresh ledger instance over the SAME (still failing)
    // stores. B logs out with a clean active queue — that clean check
    // is scoped to B and proves nothing about A's retained writes.
    const second = createPreservedWritesLedger(
      failingPrimary,
      failingMirror,
    );
    expect(await second.list()).toEqual([]);
    const { api: cleanApi, calls } = apiWith({});
    const resultB = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: cleanApi,
      preservedWrites: second,
      departingUid: "user-B",
    });
    expect(resultB.cleared).toBe(false);
    expect(resultB.reason).toBe("pending-writes-preserved");
    expect(resultB.detail).toMatch(/could not (be )?prov|positive|live/i);
    // terminate() and clearIndexedDbPersistence() were never called:
    // nothing was destroyed.
    expect(calls).toEqual(["waitForPendingWrites"]);
  });

  it("still clears when the ledger channel is live and the ledger is empty", async () => {
    // The refusal above is about an unprovable clear, not about
    // never clearing: healthy stores + empty ledger + clean active
    // queue still clears. (Guards the probe against refusing every
    // healthy logout.)
    const { store } = memoryAsyncStore();
    const ledger = createPreservedWritesLedger(store);
    const { api, calls } = apiWith({});
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: "user-B",
      mutationQueue: cleanInspector(),
    });
    expect(result).toEqual({ cleared: true, reason: "cleared" });
    expect(calls).toEqual([
      "waitForPendingWrites",
      "terminate",
      "clearIndexedDbPersistence",
    ]);
  });
});

/**
 * Store whose writes fail while `failing` and succeed after it is
 * cleared (round 5): models a TRANSIENT store failure that heals
 * before the next logout. Reads always work and return the stored
 * value — only the writes were refused at record time.
 */
function flakyAsyncStore(): {
  store: PreservedWritesStorage;
  setFailing(failing: boolean): void;
} {
  let value: string | null = null;
  let failing = false;
  return {
    store: {
      read: async () => value,
      write: async (v: string) => {
        if (failing) throw new Error("QuotaExceededError: setItem failed");
        value = v;
      },
      remove: async () => {
        if (failing) throw new Error("denied");
        value = null;
      },
    },
    setFailing(f: boolean) {
      failing = f;
    },
  };
}

/**
 * Minimal fake `document.cookie` jar (round 5) — see
 * preservedWrites.test.ts for the same helper. Setting `cookie`
 * stores the first `name=value` segment; `max-age=0` deletes.
 */
function fakeCookieJar() {
  const jar = new Map<string, string>();
  return {
    get cookie() {
      return [...jar.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
    set cookie(raw: string) {
      const [pair, ...directives] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) return;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0\b/.test(directives.join(";"))) jar.delete(name);
      else jar.set(name, value);
    },
  };
}

/** A jar that silently drops every write (cookies disabled/blocked). */
function droppingCookieJar() {
  return {
    get cookie() {
      return "";
    },
    set cookie(_value: string) {
      // Silently ignored.
    },
  };
}

describe("clearFirestoreCacheOnLogout — healed transient window (round 5)", () => {
  it("refuses a later clean logout after both ledger stores failed at record time and recovered (cookie holds the record)", async () => {
    // REGRESSION (round 5): the transient-heal window round 4 left
    // open. Both ledger stores refuse writes while A logs out with
    // pending writes; the record lands ONLY in the cookie (a third,
    // synchronous, independent store). The stores then recover before
    // B's logout — a live empty ledger from the recovered stores must
    // NOT authorise the clear: the cookie still holds A's record.
    // No real cache deletion happens in this test: the refusal is
    // asserted from the result + call list, and A's record survives.
    const primary = flakyAsyncStore();
    const mirror = flakyAsyncStore();
    const jar = fakeCookieJar();
    primary.setFailing(true);
    mirror.setFailing(true);
    const first = createPreservedWritesLedger(
      primary.store,
      mirror.store,
      createCookieStore(jar),
    );
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
    expect(resultA.reason).toBe("pending-writes-preserved");
    // The record landed durably (in the cookie) — no "could not be
    // written durably" warning.
    expect(resultA.detail ?? "").not.toMatch(/could not be written durably/);
    expect(await first.list()).toEqual(["user-A"]);

    // The stores recover before B's logout (the transient window).
    primary.setFailing(false);
    mirror.setFailing(false);
    // Reload: a fresh ledger instance over the SAME stores.
    const second = createPreservedWritesLedger(
      primary.store,
      mirror.store,
      createCookieStore(jar),
    );
    expect(await second.list()).toEqual(["user-A"]);
    const { api: cleanApi, calls } = apiWith({});
    const resultB = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: cleanApi,
      preservedWrites: second,
      departingUid: "user-B",
    });
    expect(resultB.cleared).toBe(false);
    expect(resultB.reason).toBe("pending-writes-preserved");
    // terminate() and clearIndexedDbPersistence() were never called:
    // A's pending write survived B's logout.
    expect(calls).toEqual(["waitForPendingWrites"]);
    expect(await second.list()).toEqual(["user-A"]);
  });

  it("still clears when the ledger is empty and all three channels are live", async () => {
    // The refusal above is about an unprovable clear, not about never
    // clearing: healthy stores + empty ledger + clean active queue
    // still clears. (Guards the cookie probe against refusing every
    // healthy logout.)
    const { store: primary } = memoryAsyncStore();
    const { store: mirror } = memoryAsyncStore();
    const ledger = createPreservedWritesLedger(
      primary,
      mirror,
      createCookieStore(fakeCookieJar()),
    );
    const { api, calls } = apiWith({});
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: "user-B",
      mutationQueue: cleanInspector(),
    });
    expect(result).toEqual({ cleared: true, reason: "cleared" });
    expect(calls).toEqual([
      "waitForPendingWrites",
      "terminate",
      "clearIndexedDbPersistence",
    ]);
  });

  it("refuses when all three stores are down at record time and still down at the next logout", async () => {
    // All three channels dead at A's record: the record lands nowhere
    // (record() reports false) and the stores are STILL down at B's
    // logout, so no channel can prove the ledger live.
    const first = createPreservedWritesLedger(
      failingAsyncStore(),
      failingAsyncStore(),
      createCookieStore(droppingCookieJar()),
    );
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
    expect(resultA.detail).toMatch(/could not be written durably/);

    const second = createPreservedWritesLedger(
      failingAsyncStore(),
      failingAsyncStore(),
      createCookieStore(droppingCookieJar()),
    );
    const { api: cleanApi, calls } = apiWith({});
    const resultB = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: cleanApi,
      preservedWrites: second,
      departingUid: "user-B",
    });
    expect(resultB.cleared).toBe(false);
    expect(resultB.reason).toBe("pending-writes-preserved");
    expect(calls).toEqual(["waitForPendingWrites"]);
  });

  it("refuses when the cookie channel is dead at the next logout even though the other stores are live and empty", async () => {
    // POSITIVE-PROOF test: the two ledger stores are live and empty,
    // but the cookie channel silently drops writes (cookies disabled).
    // A disabled cookie jar reads empty WITHOUT throwing, so its
    // emptiness proves nothing — a record lost when the other stores
    // were down could be hiding there. The clear is refused.
    const { store: primary } = memoryAsyncStore();
    const { store: mirror } = memoryAsyncStore();
    const ledger = createPreservedWritesLedger(
      primary,
      mirror,
      createCookieStore(droppingCookieJar()),
    );
    const { api, calls } = apiWith({});
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: "user-B",
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-writes-preserved");
    expect(calls).toEqual(["waitForPendingWrites"]);
  });
});

/**
 * Cookie jar whose writes fail while `failing` and succeed after it
 * is cleared (round 6): models the cookie channel dying at record
 * time and healing before the next logout. While failing, the setter
 * silently drops the write — exactly how a blocked cookie jar
 * behaves — so createCookieStore's read-back verification throws.
 */
function flakyCookieJar(): {
  jar: { cookie: string };
  setFailing(failing: boolean): void;
} {
  const backing = new Map<string, string>();
  let failing = false;
  return {
    jar: {
      get cookie() {
        return [...backing.entries()]
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
      },
      set cookie(raw: string) {
        if (failing) return; // Silently dropped.
        const [pair, ...directives] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq === -1) return;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (/max-age=0\b/.test(directives.join(";"))) backing.delete(name);
        else backing.set(name, value);
      },
    },
    setFailing(f: boolean) {
      failing = f;
    },
  };
}

/**
 * Minimal fake of the Firestore SDK's own IndexedDB database (round 6)
 * — same layout as in firestoreMutationQueue.test.ts: database
 * `firestore/[DEFAULT]/driver-saathi-app/main`, stores
 * `mutationQueues` and `mutations` (index `userMutationsIndex`).
 * Shared across the "reload" so B's logout inspects the same queue
 * A's writes landed in.
 */
const SDK_DB_NAME = "firestore/[DEFAULT]/driver-saathi-app/main";

class FakeSdkDb {
  private stores = new Map<
    string,
    { records: Map<number, Record<string, unknown>>; indexes: Set<string> }
  >();

  constructor() {
    this.stores.set("mutationQueues", {
      records: new Map(),
      indexes: new Set(),
    });
    this.stores.set("mutations", {
      records: new Map(),
      indexes: new Set(["userMutationsIndex"]),
    });
  }

  addBatch(uid: string, batchId: number) {
    this.stores.get("mutations")?.records.set(batchId, {
      userId: uid,
      batchId,
      mutations: [{ type: "set" }],
    });
  }

  removeBatch(batchId: number) {
    this.stores.get("mutations")?.records.delete(batchId);
  }

  asFactory(): IDBFactory {
    const data = this.stores;
    const factory = {
      databases: async () => [{ name: SDK_DB_NAME, version: 18 }],
      open: (name: string) => {
        const req: Record<string, unknown> = {
          result: undefined,
          error: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          onblocked: null,
        };
        setTimeout(() => {
          const db: Record<string, unknown> = {
            objectStoreNames: {
              contains: (storeName: string) => data.has(storeName),
            },
            close: () => {},
            transaction: (
              _storeNames: string | string[],
              _mode?: IDBTransactionMode,
            ) => {
              const tx: Record<string, unknown> = {
                oncomplete: null,
                onerror: null,
                onabort: null,
                error: null,
                objectStore: (storeName: string) => {
                  const storeData = data.get(storeName);
                  if (!storeData) {
                    throw new Error(`NotFoundError: ${storeName}`);
                  }
                  return {
                    index: (indexName: string) => {
                      if (!storeData.indexes.has(indexName)) {
                        throw new Error(`NotFoundError: index ${indexName}`);
                      }
                      return {};
                    },
                    getAll: () => {
                      const getReq: Record<string, unknown> = {
                        result: undefined,
                        error: null,
                        onsuccess: null,
                        onerror: null,
                      };
                      setTimeout(() => {
                        getReq.result = [...storeData.records.values()];
                        (getReq.onsuccess as ((ev: Event) => void) | null)?.(
                          new Event("success"),
                        );
                        setTimeout(() => {
                          (tx.oncomplete as ((ev: Event) => void) | null)?.(
                            new Event("complete"),
                          );
                        }, 0);
                      }, 0);
                      return getReq;
                    },
                  };
                },
              };
              return tx;
            },
          };
          req.result = db;
          (req.onsuccess as ((ev: Event) => void) | null)?.(
            new Event("success"),
          );
        }, 0);
        return req as unknown as IDBOpenDBRequest;
      },
    };
    return factory as unknown as IDBFactory;
  }
}

/** The REAL inspector over the fake SDK database (not a stub). */
function realInspector(sdkDb: FakeSdkDb): MutationQueueInspector {
  return createFirestoreMutationQueueInspector({
    projectId: "driver-saathi-app",
    factory: sdkDb.asFactory(),
    timeoutMs: 1000,
  });
}

describe("clearFirestoreCacheOnLogout — all-three-stores case (round 6)", () => {
  it("(i) all three ledger stores fail at A's record, heal, and B's clean logout still does NOT clear — the SDK queue proves it", async () => {
    // FAILING-FIRST (round 6a): the case the user named STILL
    // unresolved. All THREE ledger stores refuse A's record, then
    // recover before B's logout. The ledger reads live-and-empty and
    // B's active queue is clean — the old gates would authorise the
    // clear and destroy A's pending write. The SDK's own mutation
    // queue still holds A's batch, and the inspector reads it
    // directly, so the clear is refused. No real cache deletion
    // happens: the refusal is asserted from the result + call list,
    // and A's uid is re-recorded into the healed ledger (self-heal),
    // so the ledger blocks later clears too.
    const primary = flakyAsyncStore();
    const mirror = flakyAsyncStore();
    const cookie = flakyCookieJar();
    primary.setFailing(true);
    mirror.setFailing(true);
    cookie.setFailing(true);
    const sdkDb = new FakeSdkDb();
    sdkDb.addBatch("user-A", 1);

    const first = createPreservedWritesLedger(
      primary.store,
      mirror.store,
      createCookieStore(cookie.jar),
    );
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
    expect(resultA.reason).toBe("pending-writes-preserved");
    expect(resultA.detail).toMatch(/could not be written durably/);
    // The record landed nowhere: all three stores refused it.
    expect(await first.list()).toEqual([]);

    // The stores heal before B's logout (the transient window).
    primary.setFailing(false);
    mirror.setFailing(false);
    cookie.setFailing(false);
    // Reload: a fresh ledger instance over the SAME (healed) stores.
    const second = createPreservedWritesLedger(
      primary.store,
      mirror.store,
      createCookieStore(cookie.jar),
    );
    expect(await second.list()).toEqual([]);
    expect(await second.verifyLive()).toBe(true);

    const { api: cleanApi, calls } = apiWith({});
    const resultB = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: cleanApi,
      preservedWrites: second,
      departingUid: "user-B",
      mutationQueue: realInspector(sdkDb),
    });
    expect(resultB.cleared).toBe(false);
    expect(resultB.reason).toBe("pending-writes-preserved");
    expect(resultB.detail).toMatch(/mutation queue/i);
    // terminate() and clearIndexedDbPersistence() were never called:
    // A's pending write survived B's logout.
    expect(calls).toEqual(["waitForPendingWrites"]);
    // Self-heal: the inspector's pending uid was recorded into the
    // healed ledger, so a later logout is blocked by the ledger too.
    expect(await second.list()).toEqual(["user-A"]);
  });

  it("(ii) a cookie-only record deleted before B's logout still does NOT clear — the SDK queue proves it", async () => {
    // FAILING-FIRST (round 6b): the preserved cookie-only case. Both
    // ledger stores refuse A's record, so it lands ONLY in the
    // cookie; the stores then heal, and the cookie is deleted before
    // B's logout. The ledger reads live-and-empty — but A's batch is
    // still in the SDK mutation queue, and the inspector sees it.
    const primary = flakyAsyncStore();
    const mirror = flakyAsyncStore();
    const cookie = flakyCookieJar();
    primary.setFailing(true);
    mirror.setFailing(true);
    const sdkDb = new FakeSdkDb();
    sdkDb.addBatch("user-A", 1);

    const first = createPreservedWritesLedger(
      primary.store,
      mirror.store,
      createCookieStore(cookie.jar),
    );
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
    expect(await first.list()).toEqual(["user-A"]);

    // The stores heal, and the cookie — the record's only copy — is
    // deleted before B's logout (targeted deletion, not site-data
    // clearing, so the Firestore cache itself survives).
    primary.setFailing(false);
    mirror.setFailing(false);
    cookie.jar.cookie =
      `${PRESERVED_WRITES_COOKIE_NAME}=; max-age=0; path=/; SameSite=Lax`;
    const second = createPreservedWritesLedger(
      primary.store,
      mirror.store,
      createCookieStore(cookie.jar),
    );
    expect(await second.list()).toEqual([]);
    expect(await second.verifyLive()).toBe(true);

    const { api: cleanApi, calls } = apiWith({});
    const resultB = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: cleanApi,
      preservedWrites: second,
      departingUid: "user-B",
      mutationQueue: realInspector(sdkDb),
    });
    expect(resultB.cleared).toBe(false);
    expect(resultB.reason).toBe("pending-writes-preserved");
    expect(calls).toEqual(["waitForPendingWrites"]);
    expect(await second.list()).toEqual(["user-A"]);
  });

  it("still clears when the ledger is live-and-empty AND the SDK mutation queue is empty (real inspector)", async () => {
    // The refusal above is about an unprovable clear, not about never
    // clearing: healthy ledger + empty SDK queue + clean active queue
    // still clears. (Guards the inspector against refusing every
    // healthy logout.)
    const { store: primary } = memoryAsyncStore();
    const { store: mirror } = memoryAsyncStore();
    const ledger = createPreservedWritesLedger(
      primary,
      mirror,
      createCookieStore(fakeCookieJar()),
    );
    const sdkDb = new FakeSdkDb(); // No batches: the queue is empty.
    const { api, calls } = apiWith({});
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: "user-B",
      mutationQueue: realInspector(sdkDb),
    });
    expect(result).toEqual({ cleared: true, reason: "cleared" });
    expect(calls).toEqual([
      "waitForPendingWrites",
      "terminate",
      "clearIndexedDbPersistence",
    ]);
  });

  it("clears only after the owner returns clean: the SDK queue drains, the ledger resolves, and the clear is allowed", async () => {
    // A returns, comes back online, syncs (the batch leaves the SDK
    // mutation queue), and logs out clean — only now is the
    // whole-cache clear allowed, and A's ledger entry is resolved.
    const { store: primary } = memoryAsyncStore();
    const { store: mirror } = memoryAsyncStore();
    const ledger = createPreservedWritesLedger(
      primary,
      mirror,
      createCookieStore(fakeCookieJar()),
    );
    await ledger.record("user-A");
    const sdkDb = new FakeSdkDb();
    sdkDb.addBatch("user-A", 1);

    // A is still unsynced: no clear, even though A is the departing
    // user — waitForPendingWrites is clean here in the fake API, but
    // the SDK queue still holds the batch, so the inspector refuses.
    const { api: apiA, calls: callsA } = apiWith({});
    const resultA = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: apiA,
      preservedWrites: ledger,
      departingUid: "user-A",
      mutationQueue: realInspector(sdkDb),
    });
    expect(resultA.cleared).toBe(false);
    expect(callsA).toEqual(["waitForPendingWrites"]);
    expect(await ledger.list()).toEqual(["user-A"]);

    // A syncs: the batch is acknowledged and leaves the queue.
    sdkDb.removeBatch(1);
    const { api: apiA2, calls: callsA2 } = apiWith({});
    const resultA2 = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api: apiA2,
      preservedWrites: ledger,
      departingUid: "user-A",
      mutationQueue: realInspector(sdkDb),
    });
    expect(resultA2).toEqual({ cleared: true, reason: "cleared" });
    expect(callsA2).toEqual([
      "waitForPendingWrites",
      "terminate",
      "clearIndexedDbPersistence",
    ]);
    expect(await ledger.list()).toEqual([]);
  });

  it("refuses when the SDK mutation queue cannot be inspected (unknown), even with a live empty ledger", async () => {
    // Fail-closed: an inspector that cannot read the queue proves
    // nothing, so an empty ledger must not authorise the clear.
    const { store: primary } = memoryAsyncStore();
    const { store: mirror } = memoryAsyncStore();
    const ledger = createPreservedWritesLedger(
      primary,
      mirror,
      createCookieStore(fakeCookieJar()),
    );
    const unknownInspector: MutationQueueInspector = {
      checkPendingMutations: async (): Promise<MutationQueueCheck> => ({
        status: "unknown",
        detail: "IndexedDB is not available",
      }),
    };
    const { api, calls } = apiWith({});
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: "user-B",
      mutationQueue: unknownInspector,
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-writes-preserved");
    expect(result.detail).toMatch(/mutation queue/i);
    expect(calls).toEqual(["waitForPendingWrites"]);
  });

  it("refuses when the inspector reports pending batches, even with no ledger entry at all", async () => {
    // The ledger never saw this identity (e.g. its session ended
    // without this logout flow): the SDK queue is the only trace, and
    // it is enough to refuse — and to record the uid for later.
    const ledger = memoryLedger();
    const { api, calls } = apiWith({});
    const result = await clearFirestoreCacheOnLogout(fakeDb, {
      timeoutMs: 50,
      api,
      preservedWrites: ledger,
      departingUid: "user-B",
      mutationQueue: pendingInspector(["user-A"]),
    });
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe("pending-writes-preserved");
    expect(calls).toEqual(["waitForPendingWrites"]);
    expect(await ledger.list()).toEqual(["user-A"]);
  });
});
