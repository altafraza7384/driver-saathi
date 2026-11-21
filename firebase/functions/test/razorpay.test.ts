import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory Firestore stand-in with the transaction semantics
// createRazorpaySubscription relies on: fenced writes re-check the lock
// value, merge applies FieldValue.delete() removal. No live provider calls:
// global fetch is stubbed per test to script Razorpay's responses.
type Data = Record<string, any>;
const store = new Map<string, Data>();
const TS = { serverTimestamp: () => ({ __ts: true }), delete: () => ({ __del: true }) };

function apply(path: string, data: Data, merge: boolean) {
  const cur = merge ? { ...(store.get(path) ?? {}) } : {};
  for (const [k, v] of Object.entries(data)) {
    if (v && (v as any).__del) delete cur[k];
    else if (v && (v as any).__ts) cur[k] = { toMillis: () => Date.now(), toDate: () => new Date() };
    else cur[k] = v;
  }
  store.set(path, cur);
}
function snapOf(path: string) {
  const data = store.get(path);
  return { exists: !!data, get: (k: string) => data?.[k], data: () => data };
}
function refOf(path: string): any {
  return {
    id: path.split("/").pop()!, path,
    get: async () => snapOf(path),
    set: async (data: Data, opts?: any) => apply(path, data, !!opts?.merge),
    update: async (data: Data) => apply(path, data, true),
    delete: async () => store.delete(path),
  };
}
const fakeDb = {
  doc: (path: string) => refOf(path),
  collection: (path: string) => ({
    where: () => ({ get: async () => ({ docs: [] }) }),
  }),
  runTransaction: async (fn: (tx: any) => any) => {
    const tx = {
      get: async (ref: any) => snapOf(ref.path),
      set: (ref: any, data: Data, opts?: any) => apply(ref.path, data, !!opts?.merge),
      update: (ref: any, data: Data) => apply(ref.path, data, true),
      delete: (ref: any) => store.delete(ref.path),
    };
    return fn(tx);
  },
};

vi.mock("../src/shared", () => ({
  db: fakeDb,
  auth: {},
  FieldValue: TS,
  requireVerifiedDriver: (req: any) => req.auth.uid,
  requireAdmin: vi.fn(),
}));

process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
process.env.RAZORPAY_KEY_SECRET = "fake_secret";

const UID = "u1";
const PLAN_DOC = { is_active: true, billing_interval: "monthly", price_inr: 99 };
const REQ = () => ({ auth: { uid: UID, token: { email_verified: true } }, data: { planInterval: "monthly", adminPlanId: "planAdmin1" } });

// fetch script: each entry matches method+path-prefix, returns [status, body] or "hang".
type Step = [string, string, [number, any] | "hang" | "defer"];
let steps: Step[] = [];
let calls: Array<{ method: string; path: string }> = [];
// "defer" steps park the provider call until the test resolves/rejects it,
// which lets two operations overlap deterministically (stale vs new lock).
let deferredCalls: Array<{ method: string; path: string; resolve: (v: any) => void; reject: (e: any) => void }> = [];
const fetchMock = vi.fn(async (url: any, opts: any) => {
  const path = String(url).replace("https://api.razorpay.com/v1", "");
  const method = opts?.method ?? "GET";
  calls.push({ method, path });
  const i = steps.findIndex(([m, p]) => m === method && path.startsWith(p));
  if (i === -1) throw new Error("unscripted fetch: " + method + " " + path);
  const [, , out] = steps[i];
  if (out === "hang") {
    const err = new Error("The operation was aborted") as any;
    err.name = "AbortError";
    throw err; // what fetch throws when AbortSignal fires
  }
  if (out === "defer") {
    return await new Promise((resolve, reject) => {
      deferredCalls.push({ method, path, resolve, reject });
    });
  }
  const [status, body] = out;
  steps.splice(i, 1); // each scripted response consumed once unless re-added
  return { ok: status < 300, status, json: async () => body } as any;
});
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  store.clear();
  calls = [];
  steps = [];
  deferredCalls = [];
  store.set("subscription_plans/planAdmin1", PLAN_DOC);
  store.set(`users/${UID}`, { full_name: "Test" });
});

async function createSub() {
  const { createRazorpaySubscription } = await import("../src/razorpay");
  return (createRazorpaySubscription as any).run(REQ());
}
function lockAgeMs(ms: number) {
  return { toMillis: () => Date.now() - ms, toDate: () => new Date(Date.now() - ms) };
}
const GOOD_PLAN = { period: "monthly", interval: 1, item: { amount: 9900, currency: "INR" } };

describe("createRazorpaySubscription lock lifecycle (mocked provider)", () => {
  it("baseline: fresh checkout creates and records one subscription, releases lock", async () => {
    steps = [
      ["POST", "/plans", [200, { id: "plan_m_99" }]],
      ["POST", "/subscriptions", [200, { id: "sub_new" }]],
    ];
    const res = await createSub();
    expect(res.subscriptionId).toBe("sub_new");
    const doc = store.get(`subscriptions/${UID}`)!;
    expect(doc.status).toBe("created");
    expect(doc.razorpaySubscriptionId).toBe("sub_new");
    expect(doc.checkoutLock).toBeUndefined();
  });

  it("fresh overlapping lock is rejected without any provider call", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "other-op", checkoutLockedAt: lockAgeMs(60_000) });
    await expect(createSub()).rejects.toMatchObject({ code: "failed-precondition" });
    expect(calls.length).toBe(0);
    expect(store.get(`subscriptions/${UID}`)!.checkoutLock).toBe("other-op");
  });

  it("stale lock is reclaimed and the interrupted attempt's still-unauthorized subscription is ADOPTED, not duplicated", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "old-op", checkoutLockedAt: lockAgeMs(10 * 60_000) });
    steps = [
      ["GET", "/subscriptions?from=", [200, { items: [{ id: "sub_orphan", status: "created", plan_id: "plan_m_99", notes: { userId: UID }, start_at: 2000000000 }] }]],
      ["GET", "/plans/plan_m_99", [200, GOOD_PLAN]],
    ];
    const res = await createSub();
    expect(res.subscriptionId).toBe("sub_orphan");
    expect(calls.some((c) => c.method === "POST" && c.path === "/subscriptions")).toBe(false);
    const doc = store.get(`subscriptions/${UID}`)!;
    expect(doc.razorpaySubscriptionId).toBe("sub_orphan");
    expect(doc.checkoutLock).toBeUndefined();
  });

  it("stale lock + wrong-price orphan: NEVER cancelled at provider, recorded for review, checkout refused", async () => {
    // Razorpay's cancel API has no status condition and is irreversible; a
    // 'created' orphan may be mid-authentication by the customer. Check-then-
    // cancel is a TOCTOU race, so reconciliation must not call cancel at all.
    store.set(`subscriptions/${UID}`, { checkoutLock: "old-op", checkoutLockedAt: lockAgeMs(10 * 60_000) });
    steps = [
      ["GET", "/subscriptions?from=", [200, { items: [{ id: "sub_bad", status: "created", plan_id: "plan_other", notes: { userId: UID } }] }]],
      ["GET", "/plans/plan_other", [200, { period: "yearly", interval: 1, item: { amount: 99900, currency: "INR" } }]],
    ];
    await expect(createSub()).rejects.toMatchObject({ code: "failed-precondition" });
    expect(calls.some((c) => /\/cancel$/.test(c.path))).toBe(false);
    expect(calls.some((c) => c.method === "POST" && c.path === "/subscriptions")).toBe(false);
    const doc = store.get(`subscriptions/${UID}`)!;
    expect(doc.orphanedSubscriptionIds).toEqual(["sub_bad"]);
    expect(doc.reconciliationNeeded).toBe(true);
    expect(doc.checkoutLock).toBeUndefined();
    expect(doc.razorpaySubscriptionId).toBeUndefined();
  });

  it("ambiguous live orphan state (halted): recorded and refused, no provider cancel", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "old-op", checkoutLockedAt: lockAgeMs(10 * 60_000) });
    steps = [
      ["GET", "/subscriptions?from=", [200, { items: [{ id: "sub_halted", status: "halted", plan_id: "plan_m_99", notes: { userId: UID } }] }]],
    ];
    await expect(createSub()).rejects.toMatchObject({ code: "failed-precondition" });
    expect(calls.some((c) => /\/cancel$/.test(c.path))).toBe(false);
    const doc = store.get(`subscriptions/${UID}`)!;
    expect(doc.orphanedSubscriptionIds).toEqual(["sub_halted"]);
    expect(doc.reconciliationNeeded).toBe(true);
  });

  it("two unauthorized orphans: ambiguous, so neither adopted nor cancelled - both recorded, checkout refused", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "old-op", checkoutLockedAt: lockAgeMs(10 * 60_000) });
    steps = [
      ["GET", "/subscriptions?from=", [200, { items: [
        { id: "sub_a", status: "created", plan_id: "plan_m_99", notes: { userId: UID }, start_at: 2000000000 },
        { id: "sub_b", status: "created", plan_id: "plan_m_99", notes: { userId: UID }, start_at: 2000000001 },
      ] }]],
      ["GET", "/plans/plan_m_99", [200, GOOD_PLAN]],
      ["GET", "/plans/plan_m_99", [200, GOOD_PLAN]],
    ];
    await expect(createSub()).rejects.toMatchObject({ code: "failed-precondition" });
    expect(calls.some((c) => /\/cancel$/.test(c.path))).toBe(false);
    const doc = store.get(`subscriptions/${UID}`)!;
    // NEITHER is adopted, so support must see BOTH provider-side ids: the
    // orphan and the discarded adopted candidate (Muse review Gap 2).
    expect(doc.orphanedSubscriptionIds).toEqual(["sub_b", "sub_a"]);
    expect(doc.reconciliationNeeded).toBe(true);
    expect(doc.razorpaySubscriptionId).toBeUndefined();
  });

  it("reconciliation finds an ALREADY-AUTHENTICATED provider subscription: it is recorded (not stranded) and the new checkout is refused", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "old-op", checkoutLockedAt: lockAgeMs(10 * 60_000) });
    steps = [
      ["GET", "/subscriptions?from=", [200, { items: [{ id: "sub_late", status: "authenticated", plan_id: "plan_m_99", notes: { userId: UID } }] }]],
    ];
    await expect(createSub()).rejects.toMatchObject({ code: "failed-precondition" });
    const doc = store.get(`subscriptions/${UID}`)!;
    expect(doc.razorpaySubscriptionId).toBe("sub_late");
    expect(doc.status).toBe("authenticated");
    expect(doc.checkoutLock).toBeUndefined();
  });

  it("provider list failure during reconciliation: error surfaces, OUR lock is released for retry, nothing created", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "old-op", checkoutLockedAt: lockAgeMs(10 * 60_000) });
    steps = [["GET", "/subscriptions?from=", [500, { error: { description: "server error" } }]]];
    await expect(createSub()).rejects.toBeTruthy();
    expect(calls.some((c) => c.method === "POST" && c.path === "/subscriptions")).toBe(false);
    expect(store.get(`subscriptions/${UID}`)!.checkoutLock).toBeUndefined();
  });

  it("full provider page is treated as ambiguous: refuse instead of risking a duplicate", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "old-op", checkoutLockedAt: lockAgeMs(10 * 60_000) });
    const items = Array.from({ length: 100 }, (_, i) => ({ id: "sub_" + i, status: "created", notes: { userId: "someone_else" } }));
    steps = [["GET", "/subscriptions?from=", [200, { items }]]];
    await expect(createSub()).rejects.toMatchObject({ code: "failed-precondition" });
    expect(calls.some((c) => c.method === "POST" && c.path === "/subscriptions")).toBe(false);
  });

  it("provider create call times out / unreachable: lock is KEPT, user told confirmation is pending", async () => {
    steps = [
      ["POST", "/plans", [200, { id: "plan_m_99" }]],
      ["POST", "/subscriptions", "hang"],
    ];
    await expect(createSub()).rejects.toMatchObject({ code: "failed-precondition" });
    const doc = store.get(`subscriptions/${UID}`)!;
    expect(doc.checkoutLock).toBeTruthy(); // retained so the next attempt reconciles instead of duplicating
  });

  it("LATE SUCCESS after reclaim: stale handler's fenced record write cannot overwrite the reclaimed operation's adopted state", async () => {
    // op1 starts checkout and parks inside the provider create call.
    steps = [
      ["POST", "/plans", [200, { id: "plan_m_99" }]],
      ["POST", "/subscriptions", "defer"],
    ];
    const p1 = createSub().then((r) => ({ ok: r as any }), (e) => ({ err: e as any }));
    while (!deferredCalls.some((d) => d.method === "POST" && d.path === "/subscriptions")) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // Time passes while op1's request is in flight: its lock goes stale.
    store.get(`subscriptions/${UID}`)!.checkoutLockedAt = lockAgeMs(10 * 60_000);
    // op2 reclaims the stale lock, finds op1's provider-side subscription
    // already created (still unauthorized), and adopts it.
    steps = [
      ["GET", "/subscriptions?from=", [200, { items: [{ id: "sub_late", status: "created", plan_id: "plan_m_99", notes: { userId: UID }, start_at: 2000000000 }] }]],
      ["GET", "/plans/plan_m_99", [200, GOOD_PLAN]],
    ];
    const r2 = await createSub();
    expect(r2.subscriptionId).toBe("sub_late");
    expect(store.get(`subscriptions/${UID}`)!.trialEndsAt.getTime()).toBe(2000000000 * 1000);
    // NOW op1's hung request returns a late success. Its fenced record
    // write must refuse instead of overwriting op2's adopted state.
    deferredCalls.find((d) => d.path === "/subscriptions")!.resolve({ ok: true, status: 200, json: async () => ({ id: "sub_late" }) });
    const r1 = await p1;
    expect((r1 as any).err).toMatchObject({ code: "failed-precondition" });
    const doc = store.get(`subscriptions/${UID}`)!;
    expect(doc.razorpaySubscriptionId).toBe("sub_late");
    expect(doc.trialEndsAt.getTime()).toBe(2000000000 * 1000); // op2's adoption, not op1's overwrite
    expect(doc.checkoutLock).toBeUndefined();
  });

  it("stale handler's fenced RELEASE cannot delete a newer operation's fresh lock", async () => {
    // op1 parks inside the plan call (before any subscription is submitted).
    steps = [["POST", "/plans", "defer"]];
    const p1 = createSub().then((r) => ({ ok: r as any }), (e) => ({ err: e as any }));
    while (!deferredCalls.some((d) => d.method === "POST" && d.path === "/plans")) {
      await new Promise((r) => setTimeout(r, 10));
    }
    store.get(`subscriptions/${UID}`)!.checkoutLockedAt = lockAgeMs(10 * 60_000);
    // op2 reclaims and completes a normal checkout, releasing its own lock.
    steps = [
      ["GET", "/subscriptions?from=", [200, { items: [] }]],
      ["POST", "/plans", [200, { id: "plan_m_99" }]],
      ["POST", "/subscriptions", [200, { id: "sub_op2" }]],
    ];
    const r2 = await createSub();
    expect(r2.subscriptionId).toBe("sub_op2");
    // op3 starts, acquires a fresh lock, then parks verifying the existing
    // 'created' subscription op2 recorded (the reuse path).
    steps = [["GET", "/subscriptions/sub_op2", "defer"]];
    const p3 = createSub().then((r) => ({ ok: r as any }), (e) => ({ err: e as any }));
    while (!deferredCalls.some((d) => d.method === "GET" && d.path === "/subscriptions/sub_op2")) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const freshLock = store.get(`subscriptions/${UID}`)!.checkoutLock;
    expect(freshLock).toBeDefined();
    // op1's parked request finally aborts. Its fenced release must NOT
    // delete op3's newer lock.
    const d1 = deferredCalls.find((d) => d.method === "POST" && d.path === "/plans")!;
    const err = new Error("The operation was aborted") as any; err.name = "AbortError";
    d1.reject(err);
    const r1 = await p1;
    expect((r1 as any).err).toBeDefined();
    expect(store.get(`subscriptions/${UID}`)!.checkoutLock).toBe(freshLock);
    // cleanup: op3 finishes the reuse path and releases its own lock.
    deferredCalls.find((d) => d.method === "GET" && d.path === "/subscriptions/sub_op2")!
      .resolve({ ok: true, status: 200, json: async () => ({ id: "sub_op2", status: "created", plan_id: "plan_m_99" }) });
    steps = [["GET", "/plans/plan_m_99", [200, GOOD_PLAN]]];
    const r3 = await p3;
    expect((r3 as any).ok.subscriptionId).toBe("sub_op2");
    expect(store.get(`subscriptions/${UID}`)!.checkoutLock).toBeUndefined();
  });
});

describe("stale-lock cancel + reconciliation scoping (Muse review 2026-11-22)", () => {
  it("CANCEL is not blocked by a stale checkout lock (Gap 1: user can cancel after a killed checkout)", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "dead-op", checkoutLockedAt: lockAgeMs(10 * 60_000), razorpaySubscriptionId: "sub_live", status: "active" });
    steps = [
      ["GET", "/subscriptions/sub_live", [200, { id: "sub_live", status: "active" }]],
      ["POST", "/subscriptions/sub_live/cancel", [200, { id: "sub_live", status: "active" }]],
    ];
    const { cancelRazorpaySubscription } = await import("../src/razorpay");
    const res = await (cancelRazorpaySubscription as any).run({ auth: { uid: UID, token: { email_verified: true } } });
    expect(res.cancelled).toBe(true);
    expect(calls.some((c) => c.method === "POST" && /\/cancel$/.test(c.path))).toBe(true);
    expect(store.get(`subscriptions/${UID}`)!.checkoutLock).toBeUndefined();
    expect(store.get(`subscriptions/${UID}`)!.status).toBe("cancelling");
  });

  it("cancel still refuses a FRESH checkout lock (guard unchanged)", async () => {
    store.set(`subscriptions/${UID}`, { checkoutLock: "live-op", checkoutLockedAt: lockAgeMs(30_000), razorpaySubscriptionId: "sub_live", status: "active" });
    const { cancelRazorpaySubscription } = await import("../src/razorpay");
    await expect((cancelRazorpaySubscription as any).run({ auth: { uid: UID, token: { email_verified: true } } }))
      .rejects.toMatchObject({ code: "failed-precondition" });
    expect(calls.length).toBe(0);
    expect(store.get(`subscriptions/${UID}`)!.checkoutLock).toBe("live-op");
  });

  it("plan-change retry: an earlier attempt's 'created' sub is NOT this attempt's orphan (Gap 2)", async () => {
    const lockedAtSec = Math.floor((Date.now() - 10 * 60_000) / 1000);
    store.set(`subscriptions/${UID}`, { checkoutLock: "old-op", checkoutLockedAt: lockAgeMs(10 * 60_000) });
    steps = [
      ["GET", "/subscriptions?from=", [200, { items: [
        { id: "sub_yearly_old", status: "created", plan_id: "plan_year", notes: { userId: UID, checkoutOperationId: "previous-op" }, created_at: lockedAtSec - 600 },
      ] }]],
      ["POST", "/plans", [200, { id: "plan_m_99" }]],
      ["POST", "/subscriptions", [200, { id: "sub_new" }]],
    ];
    const res = await createSub();
    expect(res.subscriptionId).toBe("sub_new");
    // The old yearly sub was never fetched as a reconciliation candidate.
    expect(calls.some((c) => c.path === "/plans/plan_year")).toBe(false);
    const doc = store.get(`subscriptions/${UID}`)!;
    expect(doc.reconciliationNeeded).toBeUndefined();
    expect(doc.razorpaySubscriptionId).toBe("sub_new");
  });
});
