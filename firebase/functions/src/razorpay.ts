// Razorpay UPI autopay subscriptions (test mode first, live after key swap).
// No new dependency: Razorpay's API is plain REST over HTTPS with Basic
// auth, and Node 22 has global fetch. Secrets are read server-side only
// via defineSecret; the key id returned to the client is Razorpay's public
// checkout identifier, NOT the secret.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db, requireUser, FieldValue } from "./shared";

const REGION = "asia-south1";
const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

const TRIAL_DAYS = 7;

const PLANS = {
  monthly: { name: "Driver Saathi Monthly", amount: 9900, period: "monthly", totalCount: 120 },
  yearly: { name: "Driver Saathi Yearly", amount: 99900, period: "yearly", totalCount: 10 },
} as const;

type PlanInterval = keyof typeof PLANS;

type RzpJson = Record<string, unknown>;

async function rzp(path: string, method: "GET" | "POST", body?: unknown): Promise<RzpJson> {
  const auth = "Basic " + btoa(RAZORPAY_KEY_ID.value() + ":" + RAZORPAY_KEY_SECRET.value());
  const res = await fetch("https://api.razorpay.com/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as RzpJson;
  if (!res.ok) {
    const err = json.error as { description?: string } | undefined;
    console.error("Razorpay API failed:", path, res.status, err?.description ?? "unknown");
    throw new HttpsError("internal", err?.description ?? "Razorpay request failed");
  }
  return json;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Plans are created once via the API and their ids stored in
// config/razorpay_plans, so repeat calls never duplicate plans.
async function ensurePlanId(interval: PlanInterval): Promise<string> {
  const ref = db.doc("config/razorpay_plans");
  const snap = await ref.get();
  const existing = asString(snap.data()?.[interval]);
  if (existing) return existing;
  const p = PLANS[interval];
  const created = await rzp("/plans", "POST", {
    period: p.period,
    interval: 1,
    item: { name: p.name, amount: p.amount, currency: "INR" },
  });
  const id = asString(created.id);
  if (!id) throw new HttpsError("internal", "Plan creation failed");
  await ref.set({ [interval]: id }, { merge: true });
  return id;
}

function testMode(): boolean {
  return RAZORPAY_KEY_ID.value().startsWith("rzp_test_");
}

// Creates a subscription and returns what Checkout needs. The mandate is
// authorized in Checkout (UPI); the first charge happens after the 7-day
// free trial (start_at), it is never charged immediately.
export const createRazorpaySubscription = onCall(
  { region: REGION, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (req) => {
    const uid = requireUser(req);
    const interval = req.data?.planInterval;
    if (interval !== "monthly" && interval !== "yearly") {
      throw new HttpsError("invalid-argument", "Invalid plan");
    }
    const adminPlanId = asString(req.data?.adminPlanId);
    if (!adminPlanId) throw new HttpsError("invalid-argument", "Invalid plan");
    // Reuse an open created subscription instead of creating a new one on every tap.
    const existingSnap = await db.doc(`subscriptions/${uid}`).get();
    const existing = existingSnap.data();
    if (existing) {
        const existingStatus = asString(existing.status);
      const existingSubscriptionId = asString(existing.razorpaySubscriptionId);
      if (existingStatus === "created" && existingSubscriptionId) {
          if (asString(existing.planInterval) === interval) {
              return {
                  subscriptionId: existingSubscriptionId,
                keyId: RAZORPAY_KEY_ID.value(),
                testMode: testMode(),
                trialDays: TRIAL_DAYS,
              };
          }
        await rzp("/subscriptions/" + existingSubscriptionId + "/cancel", "POST", {
          cancel_at_cycle_end: 0,
        });
      } else if (existingStatus === "authenticated" || existingStatus === "active") {
        throw new HttpsError("failed-precondition", "Already subscribed");
      }
    }
    
    const planId = await ensurePlanId(interval);
    const startAt = Math.floor(Date.now() / 1000) + TRIAL_DAYS * 24 * 60 * 60;
    const sub = await rzp("/subscriptions", "POST", {
      plan_id: planId,
      total_count: PLANS[interval as PlanInterval].totalCount,
      start_at: startAt,
      customer_notify: 1,
      addons: [{ item: { name: "Mandate verification", amount: 100, currency: "INR" } }],
      notes: { userId: uid },
    });
    const subscriptionId = asString(sub.id);
    if (!subscriptionId) throw new HttpsError("internal", "Subscription creation failed");
    
    await db.doc(`subscriptions/${uid}`).set(
      {
        userId: uid,
        adminPlanId,
        planInterval: interval,
        razorpayPlanId: planId,
        razorpaySubscriptionId: subscriptionId,
        status: "created",
        trialEndsAt: new Date(startAt * 1000),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { subscriptionId, keyId: RAZORPAY_KEY_ID.value(), testMode: testMode(), trialDays: TRIAL_DAYS };
  },
);

// Verifies a subscription server-side against Razorpay's API — the client
// callback alone is never trusted. Records "authenticated" once the mandate
// is authorized. Paid limits flip later via the webhook (phase 2), which
// also handles renewals, failures and cancellations from Razorpay.
export const confirmRazorpaySubscription = onCall(
  { region: REGION, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (req) => {
    const uid = requireUser(req);
    const subscriptionId = asString(req.data?.subscriptionId);
    if (!subscriptionId) throw new HttpsError("invalid-argument", "Invalid subscription");
    const stored = await db.doc(`subscriptions/${uid}`).get();
    const storedData = stored.data();
    if (!storedData || asString(storedData.razorpaySubscriptionId) !== subscriptionId) {
      throw new HttpsError("invalid-argument", "Invalid subscription");
    }
    const paymentId = asString(req.data?.paymentId);
    const signature = asString(req.data?.signature);
    if (!paymentId || !signature) throw new HttpsError("invalid-argument", "Invalid payment");
    const expected = await hmacHex(RAZORPAY_KEY_SECRET.value(), paymentId + "|" + subscriptionId);
    if (!safeEqual(expected, signature)) throw new HttpsError("invalid-argument", "Invalid signature");
    const sub = await rzp("/subscriptions/" + subscriptionId, "GET");
    const status = asString(sub.status);
    if (status !== "authenticated" && status !== "active") return { verified: false, status };
    await db.doc(`subscriptions/${uid}`).set(
      { status, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { verified: true, status, testMode: testMode() };
  },
);

export const getSubscriptionStatus = onCall({ region: REGION }, async (req) => { const uid = requireUser(req); const snap = await db.doc(`subscriptions/${uid}`).get(); const d = snap.data(); if (!d) return { status: null, planInterval: null }; return { status: asString(d.status), planInterval: asString(d.planInterval) }; });

// Clear cancel path (part of launch terms): cancels at the end of the
// current billing cycle by default, so the user keeps paid access until
// then and is never charged again after.
export const cancelRazorpaySubscription = onCall(
  { region: REGION, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] },
  async (req) => {
    const uid = requireUser(req);
    const snap = await db.doc(`subscriptions/${uid}`).get();
    const subscriptionId = asString(snap.data()?.razorpaySubscriptionId);
    if (!subscriptionId) throw new HttpsError("failed-precondition", "No subscription found");
    const atCycleEnd = req.data?.atCycleEnd !== false;
    await rzp("/subscriptions/" + subscriptionId + "/cancel", "POST", {
      cancel_at_cycle_end: atCycleEnd ? 1 : 0,
    });
    await db.doc(`subscriptions/${uid}`).set(
      { status: "cancelled", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { cancelled: true };
  },
);
