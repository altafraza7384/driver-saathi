import { describe, it, expect, vi, beforeEach } from "vitest";

// Blocked-account billing access (owner decision 2026-11-21): a blocked
// account must never start a NEW paid checkout, but subscription status,
// confirm and cancellation stay open so a paid user is never stranded.
// No live provider calls: global fetch is stubbed per test.
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

type Step = [string, string, [number, any]];
let steps: Step[] = [];
let calls: Array<{ method: string; path: string }> = [];
const fetchMock = vi.fn(async (url: any, opts: any) => {
  const path = String(url).replace("https://api.razorpay.com/v1", "");
  const method = opts?.method ?? "GET";
  calls.push({ method, path });
  const i = steps.findIndex(([m, p]) => m === method && path.startsWith(p));
  if (i === -1) throw new Error("unscripted fetch: " + method + " " + path);
  const [, , out] = steps[i];
  const [status, body] = out;
  steps.splice(i, 1);
  return { ok: status < 300, status, json: async () => body } as any;
});
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  store.clear();
  calls = [];
  steps = [];
  store.set("subscription_plans/planAdmin1", PLAN_DOC);
  store.set(`users/${UID}`, { full_name: "Test" });
});

async function createSub() {
  const { createRazorpaySubscription } = await import("../src/razorpay");
  return (createRazorpaySubscription as any).run(REQ());
}
async function statusRead() {
  const { getSubscriptionStatus } = await import("../src/razorpay");
  return (getSubscriptionStatus as any).run({ auth: { uid: UID, token: { email_verified: true } }, data: {} });
}
async function confirm(subscriptionId: string, paymentId: string, signature: string) {
  const { confirmRazorpaySubscription } = await import("../src/razorpay");
  return (confirmRazorpaySubscription as any).run({ auth: { uid: UID, token: { email_verified: true } }, data: { subscriptionId, paymentId, signature } });
}
async function cancel() {
  const { cancelRazorpaySubscription } = await import("../src/razorpay");
  return (cancelRazorpaySubscription as any).run({ auth: { uid: UID, token: { email_verified: true } }, data: {} });
}
async function hmac(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("blocked account billing access (mocked provider)", () => {
  it("blocked account: NEW checkout rejected with permission-denied and ZERO provider calls, no lock taken", async () => {
    store.set(`users/${UID}`, { full_name: "Test", is_blocked: true });
    await expect(createSub()).rejects.toMatchObject({ code: "permission-denied" });
    expect(calls.length).toBe(0);
    expect(store.get(`subscriptions/${UID}`)?.checkoutLock).toBeUndefined();
  });

  it("control: non-blocked account checkout proceeds normally", async () => {
    steps = [
      ["POST", "/plans", [200, { id: "plan_m_99" }]],
      ["POST", "/subscriptions", [200, { id: "sub_ok" }]],
    ];
    const res = await createSub();
    expect(res.subscriptionId).toBe("sub_ok");
  });

  it("blocked account: subscription STATUS read stays open", async () => {
    store.set(`users/${UID}`, { full_name: "Test", is_blocked: true });
    store.set(`subscriptions/${UID}`, { status: "active", planInterval: "monthly", razorpaySubscriptionId: "sub_x" });
    const res = await statusRead();
    expect(res.status).toBe("active");
    expect(res.planInterval).toBe("monthly");
    expect(calls.length).toBe(0); // status is a Firestore read, no provider call
  });

  it("blocked account: CONFIRM stays open and records the authorized mandate", async () => {
    store.set(`users/${UID}`, { full_name: "Test", is_blocked: true });
    store.set(`subscriptions/${UID}`, { status: "created", planInterval: "monthly", razorpaySubscriptionId: "sub_x" });
    const signature = await hmac("fake_secret", "pay_1|sub_x");
    steps = [["GET", "/subscriptions/sub_x", [200, { id: "sub_x", status: "authenticated" }]]];
    const res = await confirm("sub_x", "pay_1", signature);
    expect(res.verified).toBe(true);
    expect(res.status).toBe("authenticated");
    expect(store.get(`subscriptions/${UID}`)!.status).toBe("authenticated");
  });

  it("blocked account: CANCELLATION stays open (cancel at cycle end recorded as cancelling)", async () => {
    store.set(`users/${UID}`, { full_name: "Test", is_blocked: true });
    store.set(`subscriptions/${UID}`, { status: "active", planInterval: "monthly", razorpaySubscriptionId: "sub_x" });
    steps = [
      ["GET", "/subscriptions/sub_x", [200, { id: "sub_x", status: "active" }]],
      ["POST", "/subscriptions/sub_x/cancel", [200, { id: "sub_x", status: "active" }]],
    ];
    const res = await cancel();
    expect(res.status).toBe("cancelling");
    expect(store.get(`subscriptions/${UID}`)!.status).toBe("cancelling");
  });
});
