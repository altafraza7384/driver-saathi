// Razorpay UPI autopay subscriptions (test mode first, live after key swap).
// No new dependency: Razorpay's API is plain REST over HTTPS with Basic
// auth, and Node 22 has global fetch. Secrets are read server-side only
// via defineSecret; the key id returned to the client is Razorpay's public
// checkout identifier, NOT the secret.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db, requireUser, FieldValue } from "./shared";

const REGION = "asia-south1";
export const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
export const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");

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
    throw new HttpsError("internal", err?.description ?? "Razorpay request failed", { razorpayStatus: res.status });
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
    // The client sends the plan id; verify it exists and matches the paid
    // interval, so a modified client cannot record a different plan.
    const planDoc = await db.doc(`subscription_plans/${adminPlanId}`).get();
    if (!planDoc.exists || asString(planDoc.get("billing_interval")) !== interval) {
      throw new HttpsError("invalid-argument", "Invalid plan");
    }
    // Serialize checkouts across devices. Never put provider calls inside a
    // Firestore transaction: a transaction retry would repeat those calls.
    const subscriptionRef = db.doc(`subscriptions/${uid}`);
    const operationId = crypto.randomUUID();
    const existing = await db.runTransaction(async (tx) => {
      const deletion = await tx.get(db.doc(`subscriptions/${uid}/lifecycle/account_deletion`));
      if (deletion.exists) throw new HttpsError("failed-precondition", "Account deletion is in progress. A new checkout is not allowed.");
      const snap = await tx.get(subscriptionRef);
      const data = snap.data();
      if (data?.checkoutLock) {
        throw new HttpsError("failed-precondition", "A checkout is already being processed. Please wait before trying again.");
      }
      tx.set(subscriptionRef, {
        checkoutLock: operationId,
        checkoutLockedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return data;
    });
    let creationSubmitted = false;
    try {
      // Reuse an open created subscription instead of creating a new one on every tap.
      if (existing) {
        const existingStatus = asString(existing.status);
        const existingSubscriptionId = asString(existing.razorpaySubscriptionId);
        if (existingSubscriptionId) {
          // Stored state may lag a webhook or an earlier cancellation. Never
          // abandon an ID until Razorpay confirms that its mandate has ended.
          const current = await rzp("/subscriptions/" + existingSubscriptionId, "GET");
          const currentStatus = asString(current.status);
          if (!currentStatus) throw new HttpsError("internal", "Could not verify the existing subscription");
          const ended = ["cancelled", "completed", "expired"].includes(currentStatus);
          if (!ended && existingStatus === "cancelling") {
            throw new HttpsError("failed-precondition", "Cancellation is scheduled. Wait for the current subscription to end.");
          }
          if (currentStatus === "created" && asString(existing.planInterval) === interval
            && asString(existing.adminPlanId) === adminPlanId) {
            return {
              subscriptionId: existingSubscriptionId,
              keyId: RAZORPAY_KEY_ID.value(),
              testMode: testMode(),
              trialDays: TRIAL_DAYS,
            };
          }
          if (currentStatus === "authenticated" || currentStatus === "active") {
            throw new HttpsError("failed-precondition", "Already subscribed");
          }
          if (!ended) {
            const cancelled = await rzp("/subscriptions/" + existingSubscriptionId + "/cancel", "POST", {
              cancel_at_cycle_end: 0,
            });
            if (!["cancelled", "completed", "expired"].includes(asString(cancelled.status) ?? "")) {
              throw new HttpsError("failed-precondition", "The previous subscription has not ended. Please try again later.");
            }
          }
        } else if (existingStatus && !["cancelled", "completed", "expired"].includes(existingStatus)) {
          throw new HttpsError("failed-precondition", "The previous subscription needs reconciliation before another checkout.");
        }
      }
    
      const planId = await ensurePlanId(interval);
      const startAt = Math.floor(Date.now() / 1000) + TRIAL_DAYS * 24 * 60 * 60;
      creationSubmitted = true;
      let sub: RzpJson;
      try {
        sub = await rzp("/subscriptions", "POST", {
          plan_id: planId,
          total_count: PLANS[interval as PlanInterval].totalCount,
          start_at: startAt,
          customer_notify: 1,
          addons: [{ item: { name: "Mandate verification", amount: 100, currency: "INR" } }],
          notes: { userId: uid, checkoutOperationId: operationId },
        });
      } catch (error) {
        const status = (error as { details?: { razorpayStatus?: number } })?.details?.razorpayStatus;
        // An explicit rejection did not create a subscription. A timeout,
        // network failure or 5xx may have done so: retain its reservation.
        if (typeof status === "number" && status >= 400 && status < 500 && status !== 408) creationSubmitted = false;
        throw error;
      }
      const subscriptionId = asString(sub.id);
      if (!subscriptionId) throw new HttpsError("internal", "Subscription creation failed");
    
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(subscriptionRef);
        if (snap.get("checkoutLock") !== operationId) {
          throw new HttpsError("failed-precondition", "Checkout needs reconciliation before another attempt.");
        }
        tx.set(subscriptionRef,
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
            checkoutLock: FieldValue.delete(),
            checkoutLockedAt: FieldValue.delete(),
          },
          { merge: true },
        );
      });
      return { subscriptionId, keyId: RAZORPAY_KEY_ID.value(), testMode: testMode(), trialDays: TRIAL_DAYS };
    } catch (error) {
      if (creationSubmitted) {
        console.error("Checkout requires reconciliation", { uid, operationId });
        throw new HttpsError("failed-precondition", "Checkout confirmation is pending. Contact support before trying again.");
      }
      throw error;
    } finally {
      if (!creationSubmitted) {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(subscriptionRef);
          if (snap.get("checkoutLock") === operationId) {
            tx.update(subscriptionRef, {
              checkoutLock: FieldValue.delete(),
              checkoutLockedAt: FieldValue.delete(),
            });
          }
        });
      }
    }
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
    const recordedStatus = await db.runTransaction(async (tx) => {
      const ref = db.doc(`subscriptions/${uid}`);
      const current = await tx.get(ref);
      if (asString(current.get("razorpaySubscriptionId")) !== subscriptionId) {
        throw new HttpsError("failed-precondition", "Subscription changed. Please refresh.");
      }
      const saved = asString(current.get("status"));
      // A late Checkout callback must not erase a cancellation request.
      if (saved && ["cancelling", "cancelled", "completed", "expired"].includes(saved)) return saved;
      tx.set(ref, { status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return status;
    });
    return { verified: ["authenticated", "active", "cancelling"].includes(recordedStatus), status: recordedStatus, testMode: testMode() };
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
    const ref = db.doc(`subscriptions/${uid}`);
    const operationId = crypto.randomUUID();
    const existing = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.get("checkoutLock")) throw new HttpsError("failed-precondition", "A subscription change is already in progress. Please wait.");
      const id = asString(snap.get("razorpaySubscriptionId"));
      if (!id) throw new HttpsError("failed-precondition", "No subscription found");
      tx.set(ref, { checkoutLock: operationId }, { merge: true });
      return { id, status: asString(snap.get("status")) };
    });
    try {
      const current = await rzp("/subscriptions/" + existing.id, "GET");
      let status = asString(current.status);
      if (!status) throw new HttpsError("internal", "Could not verify the subscription");
      const ended = (value: string) => ["cancelled", "completed", "expired"].includes(value);
      // Only a running paid cycle can be cancelled at its end. A mandate
      // awaiting its first charge must be stopped immediately.
      const atCycleEnd = req.data?.atCycleEnd !== false && status === "active";
      if (!ended(status) && !(atCycleEnd && existing.status === "cancelling")) {
        const result = await rzp("/subscriptions/" + existing.id + "/cancel", "POST", {
          cancel_at_cycle_end: atCycleEnd ? 1 : 0,
        });
        status = asString(result.status);
        if (!status || (!atCycleEnd && !ended(status))) {
          throw new HttpsError("failed-precondition", "Cancellation is not confirmed. Please try again.");
        }
      }
      const nextStatus = ended(status) ? status : "cancelling";
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.get("checkoutLock") !== operationId) throw new HttpsError("failed-precondition", "Subscription changed. Please retry.");
        // A terminal webhook may arrive while the provider request is running.
        const recorded = asString(snap.get("status"));
        tx.set(ref, {
          status: recorded && recorded !== existing.status && ended(recorded) && nextStatus === "cancelling" ? recorded : nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
          checkoutLock: FieldValue.delete(),
          checkoutLockedAt: FieldValue.delete(),
        }, { merge: true });
      });
      return { cancelled: true, status: nextStatus };
    } finally {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.get("checkoutLock") === operationId) tx.update(ref, { checkoutLock: FieldValue.delete() });
      });
    }
  },
);

// Account data may be removed only after the provider confirms termination.
// Keep a server-only lifecycle marker: deleting a Firestore parent does not
// delete its subcollections, so stale sessions cannot race a new checkout.
export async function cancelSubscriptionForUser(uid: string): Promise<void> {
  const ref = db.doc(`subscriptions/${uid}`);
  const deletionRef = db.doc(`subscriptions/${uid}/lifecycle/account_deletion`);
  const operationId = crypto.randomUUID();
  const subscriptionId = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("checkoutLock")) throw new HttpsError("failed-precondition", "Wait for the current checkout to finish before deleting the account.");
    const id = asString(snap.get("razorpaySubscriptionId"));
    const status = asString(snap.get("status"));
    if (!id && status && !["cancelled", "completed", "expired"].includes(status)) {
      throw new HttpsError("failed-precondition", "Subscription needs reconciliation before account deletion.");
    }
    tx.set(deletionRef, { requestedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (snap.exists) tx.set(ref, { checkoutLock: operationId }, { merge: true });
    return id;
  });
  try {
    if (subscriptionId) {
      const current = await rzp("/subscriptions/" + subscriptionId, "GET");
      const status = asString(current.status);
      if (!status) throw new HttpsError("internal", "Could not verify the subscription before account deletion");
      if (!["cancelled", "completed", "expired"].includes(status)) {
        const cancelled = await rzp("/subscriptions/" + subscriptionId + "/cancel", "POST", { cancel_at_cycle_end: 0 });
        if (!["cancelled", "completed", "expired"].includes(asString(cancelled.status) ?? "")) {
          throw new HttpsError("failed-precondition", "Subscription cancellation is not complete. Account data has been kept.");
        }
      }
    }
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get("checkoutLock") !== operationId) {
        throw new HttpsError("failed-precondition", "Subscription changed during account deletion. Please retry.");
      }
      tx.delete(ref);
      tx.set(deletionRef, { completedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (error) {
    // Preserve the provider ID for retries. A pending deletion also blocks
    // checkouts until cancellation is reconciled, even if this call times out.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.get("checkoutLock") === operationId) tx.update(ref, { checkoutLock: FieldValue.delete() });
    });
    throw error;
  }
}
