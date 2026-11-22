/**
 * Regression tests for the sign-out flow (PR #30 corrections 1 + 2).
 *
 * The bug (fix 1): the old flow signed out of Auth FIRST and only then
 * asked Firestore whether any writes were pending. waitForPendingWrites
 * only sees the ACTIVE identity's queue, so after sign-out it saw the
 * (empty) anonymous queue and reported "clean" while the DEPARTING
 * user's offline writes were still unsynced — terminate() + clear then
 * destroyed them. The fix checks + clears BEFORE the identity change,
 * while the departing user is still signed in.
 *
 * The second bug (fix 1, same flow): a write landing between the clean
 * check and terminate()+clear was silently destroyed. The fix closes a
 * write gate for the check→clear window, so a racing write is REJECTED
 * with a retryable error instead of being silently lost.
 *
 * The third bug (fix 2): when terminate() succeeded but the clear
 * failed, the Firestore instance stayed terminated and the next read
 * threw "client already terminated". The fix reinitializes a usable
 * client over the surviving IndexedDB data (pending writes intact).
 *
 * The fake below models the real SDK behaviour the reviewers observed:
 * waitForPendingWrites is scoped to the CURRENT identity (after
 * sign-out it sees an empty queue), a terminated client rejects reads,
 * and clearIndexedDbPersistence wipes the store — including pending
 * writes — which is exactly the data loss the old order caused.
 */
import { describe, it, expect, vi } from "vitest";
import { performSignOut, type SignOutFlowDeps } from "./signOutFlow";
import type { FirestoreCacheApi } from "./logoutCache";
import type { Firestore } from "firebase/firestore";

/** Minimal in-test model of one Firestore client + its IndexedDB store. */
class FakeFirestore {
  uid: string | null = null;
  terminated = false;
  store = new Map<string, unknown>();
  pending = new Map<string, Set<string>>();
  gate = { closed: false };
  calls: string[] = [];
  /** Hook run inside waitForPendingWrites, after the snapshot decision. */
  onWaitForPendingWrites: (() => void) | null = null;
  /** Errors from racing writes attempted during the check→clear window. */
  raceErrors: unknown[] = [];
  clearCalls = 0;

  signIn(uid: string) {
    this.uid = uid;
  }

  signOut() {
    this.calls.push("signOutAuth");
    this.uid = null;
  }

  /** A user write. Rejected while the logout write gate is closed. */
  write(uid: string, key: string, value: unknown) {
    if (this.terminated) {
      throw new Error("Firestore has already been terminated");
    }
    if (this.gate.closed) {
      throw new Error("LOGOUT_WRITE_GATE: writes paused while signing out");
    }
    this.store.set(key, value);
    const set = this.pending.get(uid) ?? new Set<string>();
    set.add(key);
    this.pending.set(uid, set);
  }

  read(key: string): unknown {
    if (this.terminated) {
      throw new Error("Firestore has already been terminated");
    }
    return this.store.get(key);
  }

  /** Network comes back: every pending write syncs. */
  syncAll() {
    this.pending.clear();
  }

  /** waitForPendingWrites, scoped to the CURRENT identity (as observed
   *  in the real SDK): after sign-out it sees the empty anonymous queue
   *  and resolves, even though the previous user's writes are pending. */
  waitForPendingWrites(): Promise<void> {
    this.calls.push("waitForPendingWrites");
    const n = this.pending.get(this.uid ?? "")?.size ?? 0;
    this.onWaitForPendingWrites?.();
    return n === 0 ? Promise.resolve() : new Promise<void>(() => {});
  }

  terminate(): Promise<void> {
    this.calls.push("terminate");
    if (this.terminated) throw new Error("already terminated");
    this.terminated = true;
    return Promise.resolve();
  }

  clearIndexedDbPersistence(): Promise<void> {
    this.calls.push("clearIndexedDbPersistence");
    if (!this.terminated) {
      throw new Error(
        "failed-precondition: clearIndexedDbPersistence requires terminate first",
      );
    }
    this.clearCalls += 1;
    this.store.clear();
    this.pending.clear();
    return Promise.resolve();
  }

  /** Fresh client over the same IndexedDB store (terminate → init). */
  reinitialize() {
    this.calls.push("reinitializeFirestore");
    this.terminated = false;
  }

  asApi(): FirestoreCacheApi {
    return {
      waitForPendingWrites: () => this.waitForPendingWrites(),
      terminate: () => this.terminate(),
      clearIndexedDbPersistence: () => this.clearIndexedDbPersistence(),
    };
  }
}

function makeDeps(
  fake: FakeFirestore,
  overrides: Partial<SignOutFlowDeps> = {},
): { deps: SignOutFlowDeps; reload: ReturnType<typeof vi.fn> } {
  const reload = vi.fn();
  const deps: SignOutFlowDeps = {
    firestore: {
      db: fake as unknown as Firestore,
      api: fake.asApi(),
      timeoutMs: 50,
    },
    signOutAuth: async () => {
      fake.signOut();
    },
    signOutAuthLocal: async () => {
      fake.signOut();
    },
    cancelQueries: () => {
      fake.calls.push("cancelQueries");
    },
    clearQueries: () => {
      fake.calls.push("clearQueries");
    },
    closeWriteGate: () => {
      fake.gate.closed = true;
    },
    openWriteGate: () => {
      fake.gate.closed = false;
    },
    reinitializeFirestore: () => {
      fake.reinitialize();
    },
    reload,
    ...overrides,
  };
  return { deps, reload };
}

describe("performSignOut — departing user's pending writes (fix 1)", () => {
  it("preserves the departing user's unsynced write: no clear, write survives sign-out", async () => {
    const fake = new FakeFirestore();
    fake.signIn("user-A");
    fake.write("user-A", "tx-1", { amount: 500 });
    const { deps, reload } = makeDeps(fake);

    const result = await performSignOut(deps);

    expect(result.cache?.reason).toBe("pending-writes-preserved");
    expect(result.cache?.cleared).toBe(false);
    expect(fake.clearCalls).toBe(0);
    // The write is still there after logout — it was NOT destroyed.
    expect(fake.store.get("tx-1")).toEqual({ amount: 500 });
    expect(fake.pending.get("user-A")?.has("tx-1")).toBe(true);
    expect(result.signedOut).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("checks pending writes BEFORE Auth sign-out (ordering)", async () => {
    const fake = new FakeFirestore();
    fake.signIn("user-A");
    const { deps } = makeDeps(fake);

    const result = await performSignOut(deps);

    expect(result.cache?.cleared).toBe(true);
    expect(result.signedOut).toBe(true);
    expect(result.reloaded).toBe(true);
    // The pending-writes check must run while user-A is still the active
    // identity — i.e. before signOutAuth flips it to anonymous.
    expect(fake.calls.indexOf("waitForPendingWrites")).toBeGreaterThan(-1);
    expect(fake.calls.indexOf("waitForPendingWrites")).toBeLessThan(
      fake.calls.indexOf("signOutAuth"),
    );
    expect(fake.calls.indexOf("cancelQueries")).toBeLessThan(
      fake.calls.indexOf("waitForPendingWrites"),
    );
  });

  it("rejects a write racing the check→clear window instead of silently destroying it", async () => {
    const fake = new FakeFirestore();
    fake.signIn("user-A");
    // A write that lands after the clean snapshot but before terminate.
    fake.onWaitForPendingWrites = () => {
      try {
        fake.write("user-A", "tx-race", { amount: 100 });
      } catch (e) {
        fake.raceErrors.push(e);
      }
    };
    const { deps } = makeDeps(fake);

    const result = await performSignOut(deps);

    expect(result.cache?.cleared).toBe(true);
    // Either the racing write was rejected by the gate (so its caller can
    // retry) or it survived — it must NEVER be silently destroyed.
    const rejected = fake.raceErrors.some(
      (e) => e instanceof Error && e.message.includes("LOGOUT_WRITE_GATE"),
    );
    const survived = fake.store.has("tx-race");
    expect(rejected || survived).toBe(true);
    // The gate is reopened after the flow, so the next account can write.
    expect(fake.gate.closed).toBe(false);
  });
});

/* FIX-2 TESTS (commit B): moved out — the clear-failed reinit test lives
 * in the fix-2 commit, where it is added first (failing) and then fixed.
 * See signOutFlow.test.ts history. */
