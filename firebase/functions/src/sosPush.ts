import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "./shared";
import { chunkTokens } from "./announcements";

const REGION = "asia-south1";

type SosRequestData = {
  category?: unknown;
  approxLat?: unknown;
  approxLng?: unknown;
  areaText?: unknown;
  status?: unknown;
};

type MechanicData = {
  isOnline?: unknown;
  status?: unknown;
  categories?: unknown;
  lat?: unknown;
  lng?: unknown;
  serviceRadiusKm?: unknown;
  fcmToken?: unknown;
  phoneVerified?: unknown;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * r * Math.asin(Math.sqrt(a));
}

function normalizeCategory(c: unknown): string | null { if (c === "mechanic") return "car"; if (c === "tyre") return null; return typeof c === "string" ? c : null; }

// Mirror the Mechanic app's visible-request filter exactly: online,
// not held, category served, within service radius (radius skipped when
// either side has no coordinates, same as the app). isVerified is NOT a
// filter anywhere in the app or rules, so it is not one here either.
function mechanicMatches(m: MechanicData, r: SosRequestData): boolean {
  if (m.isOnline !== true) return false;
  if (m.status === "held") return false;
  if (m.phoneVerified !== true) return false;
  const normalizedCategory = normalizeCategory(r.category);
    if (normalizedCategory === null) return false;
  const cats = Array.isArray(m.categories) ? (m.categories as unknown[]) : [];
  if (!cats.map(normalizeCategory).includes(normalizedCategory)) return false;
  if (
    typeof m.lat === "number" &&
    typeof m.lng === "number" &&
    typeof r.approxLat === "number" &&
    typeof r.approxLng === "number"
  ) {
    const radius = typeof m.serviceRadiusKm === "number" ? m.serviceRadiusKm : 0;
    if (haversineKm(m.lat, m.lng, r.approxLat, r.approxLng) > radius) return false;
  }
  return true;
}

// Full-screen SOS push (2026-11-04): on every new pending SOS request,
// push a data-only FCM message to every ONLINE, non-held mechanic whose
// categories + radius match. Payload carries ONLY public fields (request
// id, category, area text) — never the driver phone or exact location.
// Exactly-once: the sos_push_log doc is claimed in a transaction first,
// so a function redelivery stops instead of double-pushing.
export const sendSosRequestPush = onDocumentCreated(
  { document: "sos_requests/{requestId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const req = snap.data() as SosRequestData;
    if (req.status !== "pending") return;
    const requestId = event.params.requestId;
    const logRef = db.doc(`sos_push_log/${requestId}`);
    let claimed = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(logRef);
      if (!existing.exists) {
        tx.set(logRef, { claimed_at: new Date().toISOString() });
        claimed = true;
      }
    });
    if (!claimed) return;
    const mechanics = await db.collection("mechanics").where("isOnline", "==", true).get();
    const targets: Array<{ token: string; uid: string }> = [];
    for (const d of mechanics.docs) {
      const m = d.data() as MechanicData;
      if (!mechanicMatches(m, req)) continue;
      if (typeof m.fcmToken === "string" && m.fcmToken) targets.push({ token: m.fcmToken, uid: d.id });
    }
    // Record recipients for the cancel fan-out, even when zero (so the
    // update trigger knows nobody was pushed).
    await logRef.set(
      { request_id: requestId, tokens: targets.map((t) => t.token), mechanic_uids: targets.map((t) => t.uid), sent_at: new Date().toISOString() },
      { merge: true },
    );
    if (!targets.length) return;
    const messaging = getMessaging();
    const area = typeof req.areaText === "string" ? req.areaText : "";
    const category = typeof req.category === "string" ? req.category : "";
    for (const batch of chunkTokens(targets)) {
      const res = await messaging.sendEach(
        batch.map((t) => ({
          token: t.token,
          data: { type: "sos_request", requestId, category, areaText: area },
          android: { priority: "high" as const },
        })),
      );
      // Log failures only: a failed send must not throw the trigger, or
      // a retry would double-push the mechanics that already got it.
      res.responses.forEach((r, i) => {
        if (!r.success) console.error("sendSosRequestPush: send failed", { uid: batch[i].uid, code: r.error?.code ?? "error" });
      });
    }
  },
);

// Cancel fan-out: when a pending request leaves pending (accepted,
// onway, arrived, completed, cancelled — including taken-by-another and
// driver-cancelled), push a cancel message to exactly the mechanics that
// were pushed for it, so their full-screen popup clears.
export const sendSosCancelPush = onDocumentUpdated(
  { document: "sos_requests/{requestId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data() as SosRequestData | undefined;
    const after = event.data?.after.data() as SosRequestData | undefined;
    if (!before || !after) return;
    if (before.status !== "pending" || after.status === "pending") return;
    const requestId = event.params.requestId;
    const log = await db.doc(`sos_push_log/${requestId}`).get();
    const tokens = (log.data()?.tokens as string[] | undefined) ?? [];
    if (!tokens.length) return;
    const messaging = getMessaging();
    for (const batch of chunkTokens(tokens)) {
      await messaging
        .sendEach(
          batch.map((token) => ({
            token,
            data: { type: "sos_cancel", requestId },
            android: { priority: "high" as const },
          })),
        )
        .catch((e) => console.error("sendSosCancelPush: send failed", e));
    }
  },
);
