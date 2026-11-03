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
  const eventId = req.header("x-razorpay-event-id") ?? "";
  const body = (req.body ?? {}) as { event?: unknown; payload?: { subscription?: { entity?: { id?: unknown } }; payment?: { entity?: { subscription_id?: unknown } } } };
  const eventName = typeof body.event === "string" ? body.event : "";
  if (eventId) {
    try { await db.doc(`webhook_events/${eventId}`).create({ event: eventName, receivedAt: FieldValue.serverTimestamp() }); }
    catch { res.status(200).send("duplicate"); return; }
  }
  const subId = body.payload?.subscription?.entity?.id;
  const paySubId = body.payload?.payment?.entity?.subscription_id;
  const razorpaySubId = typeof subId === "string" ? subId : typeof paySubId === "string" ? paySubId : null;
  if (razorpaySubId) {
    const snap = await db.collection("subscriptions").where("razorpaySubscriptionId", "==", razorpaySubId).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const uid = doc.id;
      const adminPlanId = doc.get("adminPlanId");
      if (eventName === "subscription.activated" || eventName === "subscription.charged") {
        await doc.ref.set({ status: "active", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        if (typeof adminPlanId === "string" && adminPlanId) {
          await db.doc(`users/${uid}`).set({ subscription_plan_id: adminPlanId }, { merge: true });
        }
      } else if (eventName === "subscription.cancelled" || eventName === "subscription.completed" || eventName === "subscription.halted") {
        const next = eventName === "subscription.completed" ? "completed" : eventName === "subscription.halted" ? "halted" : "cancelled";
        await doc.ref.set({ status: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await db.doc(`users/${uid}`).set({ subscription_plan_id: null }, { merge: true });
      } else if (eventName === "subscription.pending") {
        await doc.ref.set({ status: "pending", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  }
  res.status(200).send("ok");
});
