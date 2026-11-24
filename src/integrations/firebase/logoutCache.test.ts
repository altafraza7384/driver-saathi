import { describe, it, expect, vi } from "vitest";
import {
  clearFirestoreCacheOnLogout,
  hasNoPendingWrites,
  type FirestoreCacheApi,
} from "./logoutCache";
import {
  createCookieStore,
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
