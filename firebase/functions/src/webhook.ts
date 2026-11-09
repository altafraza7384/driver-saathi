// Razorpay webhook: subscription lifecycle events.
// Public HTTPS endpoint: Razorpay POSTs here. Signature-verified with
// RAZORPAY_WEBHOOK_SECRET (the dashboard webhook secret, in Secret Manager).
// Idempotent: Razorpay delivers at-least-once; repeated event ids are no-ops.
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db, FieldValue } from "./shared";

const REGION = "asia-south1";
const RAZORPAY_WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");

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

export const razorpayWebhook = onRequest({ region: REGION, secrets: [RAZORPAY_WEBHOOK_SECRET] }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }
  const signature = req.header("x-razorpay-signature");
  const raw = (req as unknown as { rawBody?: { toString: (enc: string) => string } }).rawBody?.toString("utf8") ?? "";
  if (!signature || !raw) { res.status(400).send("Missing signature or body"); return; }
  const expected = await hmacHex(RAZORPAY_WEBHOOK_SECRET.value(), raw);
  if (!safeEqual(expected, signature)) { res.status(400).send("Invalid signature"); return; }
  // Fallback: when Razorpay omits the event-id header, hash the raw body so a
  // repeated delivery is still deduped instead of processed twice.
  const eventId = req.header("x-razorpay-event-id") ?? `body-${await hmacHex(RAZORPAY_WEBHOOK_SECRET.value(), raw)}`;
  const body = (req.body ?? {}) as { event?: unknown; payload?: { subscription?: { entity?: { id?: unknown; status?: unknown } }; payment?: { entity?: { subscription_id?: unknown } } } };

  const eventName = typeof body.event === "string" ? body.event : "";
  const subId = body.payload?.subscription?.entity?.id;
  const paySubId = body.payload?.payment?.entity?.subscription_id;
  const razorpaySubId = typeof subId === "string" ? subId : typeof paySubId === "string" ? paySubId : null;
  const handled = ["subscription.activated", "subscription.charged", "subscription.cancelled",
    "subscription.completed", "subscription.halted", "subscription.pending"].includes(eventName);
  try {
    const duplicate = await db.runTransaction(async (tx) => {
      const eventRef = db.doc(`webhook_events/${eventId}`);
      const event = await tx.get(eventRef);
      if (event.exists) return true;
      if (handled) {
        if (!razorpaySubId) throw new Error("Missing subscription ID");
        const subscriptions = await tx.get(db.collection("subscriptions")
          .where("razorpaySubscriptionId", "==", razorpaySubId).limit(1));
        // Delivery can beat checkout persistence. Do not mark it complete:
        // a retry must still be able to apply the paid entitlement.
        if (subscriptions.empty) throw new Error("Subscription tracking is not available yet");
        const subscription = subscriptions.docs[0];
        const userRef = db.doc(`users/${subscription.id}`);
        const user = await tx.get(userRef);
        const adminPlanId = subscription.get("adminPlanId");
        const plan = typeof adminPlanId === "string" && adminPlanId
          ? await tx.get(db.doc(`subscription_plans/${adminPlanId}`)) : null;
        const previous = subscription.get("status");
        const terminal = ["cancelled", "completed", "expired"].includes(previous);
        const active = eventName === "subscription.activated" || eventName === "subscription.charged";
        if (!terminal || eventName === "subscription.cancelled" || eventName === "subscription.completed") {
          let next: string | null = null;
          if (active) {
            const entityStatus = body.payload?.subscription?.entity?.status;
            if (typeof entityStatus === "string" && entityStatus) next = entityStatus;
          } else if (eventName === "subscription.pending") next = "pending";
          else next = eventName === "subscription.completed" ? "completed" : eventName === "subscription.halted" ? "halted" : "cancelled";
          if (next) {
            if (previous === "cancelling" && !["cancelled", "completed", "expired"].includes(next)) next = "cancelling";
            tx.set(subscription.ref, { status: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            // Late provider events must not recreate a deleted account.
            if (user.exists && active && body.payload?.subscription?.entity?.status === "active"
              && typeof adminPlanId === "string" && adminPlanId && plan?.exists && plan.get("deleting") !== true) {
              tx.update(userRef, { subscription_plan_id: adminPlanId });
            } else if (user.exists && !active && eventName !== "subscription.pending"
              && user.get("subscription_plan_id") === adminPlanId) {
              tx.update(userRef, { subscription_plan_id: null });
            }
          }
        }
      }
      // Processing and its completion marker commit together or not at all.
      tx.create(eventRef, { event: eventName, receivedAt: FieldValue.serverTimestamp() });
      return false;
    });
    res.status(200).send(duplicate ? "duplicate" : "ok");
  } catch (error) {
    console.error("Razorpay webhook processing failed", error);
    res.status(500).send("Please retry");
  }
});
