import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { announcementMatchesAudience, extractFcmToken, chunkTokens } from "./announcements";
import { defineSecret } from "firebase-functions/params";
import webpush from "web-push";
import { db, auth, requireUser, requireAdmin, deleteUserData } from "./shared";

export { chat, financeAi } from "./ai";
export { dedupeInsuranceLead } from "./leads";

const REGION = "asia-south1";
const VAPID_PUBLIC_KEY = defineSecret("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = defineSecret("VAPID_PRIVATE_KEY");

export const adminListUsers = onCall({ region: REGION }, async (req) => {
  await requireAdmin(req);
  const users: any[] = [];
  let token: string | undefined;
  do {
    const page = await auth.listUsers(1000, token);
    for (const u of page.users) {
      const profile = (await db.doc(`users/${u.uid}`).get()).data() ?? {};
      const txCount = (await db.collection(`users/${u.uid}/transactions`).count().get()).data().count;
      users.push({ id: u.uid, email: u.email, created_at: u.metadata.creationTime,
        last_sign_in_at: u.metadata.lastSignInTime, profile, counts: { transactions: txCount } });
    }
    token = page.pageToken;
  } while (token);
  return { users };
});

export const deleteAccount = onCall({ region: REGION }, async (req) => {
  const uid = requireUser(req);
  if (req.data?.confirm !== "DELETE") throw new HttpsError("invalid-argument", "Confirmation required");
  await deleteUserData(uid);
  await auth.deleteUser(uid);
  return { success: true };
});

type Due = { uid: string; source: string; id: string; notifyAt: string; title: string; body: string; url: string; item: string; label: string; desc: string | null };
const SOURCES: Array<[string, [string, unknown] | null, string, string, string]> = [
  ["reminders", ["is_completed", false], "🔔 Reminder: ", "/reminders", "reminder"],
  ["debts", ["is_active", true], "💳 EMI due: ", "/debts", "EMI"],
  ["goals", ["is_completed", false], "🎯 Goal: ", "/goals", "goal"],
  ["car_checks", ["is_completed", false], "🚗 Car check: ", "/car-checks", "car check"],
  ["car_documents", null, "📄 Document expiry: ", "/car-checks", "document"],
  ["recurring_expenses", ["is_active", true], "🧾 Bill due: ", "/transactions", "bill"],
];

export const sendNotifications = onSchedule(
  { schedule: "every 5 minutes", region: REGION, secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY], retryCount: 2 },
  async () => {
    webpush.setVapidDetails("mailto:noreply@driverbuddy.app", VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
    const now = new Date();
    // 24h lookback (was 5 min): a reminder created after its notify time,
    // or a missed run, must still fire on the next run instead of being
    // lost forever. Double-sends are still impossible: the sentNotifications
    // claim below fails if the item was already sent.
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const due: Due[] = [];
    for (const [col, filter, prefix, url, label] of SOURCES) {
      let q = db.collectionGroup(col).where("notify_at", ">=", from).where("notify_at", "<=", now.toISOString());
      if (filter) q = q.where(filter[0], "==", filter[1]);
      for (const d of (await q.get()).docs) {
        const uid = d.ref.parent.parent!.id;
        const name = d.get("title") ?? d.get("name") ?? d.get("document_name") ?? d.get("check_type") ?? "";
        due.push({ uid, source: col, id: d.id, notifyAt: d.get("notify_at"), title: prefix + name, body: "", url, item: String(name), label, desc: (d.get("description") as string | null) ?? null });
      }
    }
    // Rich, CRED-style body: first name + detail, so the shade shows a
    // personal message instead of a bare "Due now". English only here: the
    // app has no server-side locale (language lives in browser storage),
    // and notification titles already use English. A missing profile/name
    // falls back to the detail sentence alone.
    const firstNames = new Map<string, string>();
    for (const n of due) {
      if (!firstNames.has(n.uid)) {
        let first = "";
        try {
          const snap = await db.doc(`users/${n.uid}`).get();
          const full = snap.exists ? (snap.get("full_name") as string | null) : null;
          first = (full ?? "").trim().split(/\s+/)[0] ?? "";
        } catch { first = ""; }
        firstNames.set(n.uid, first);
      }
      const who = firstNames.get(n.uid);
      const detail = n.desc ? n.desc : `your ${n.label} "${n.item}" is due.`;
      n.body = who ? `${who}, ${detail}` : detail;
    }
    for (const n of due) {
      const key = `${n.source}_${n.id}_${n.notifyAt}`.replace(/[\/:.]/g, "-");
      const sentRef = db.doc(`users/${n.uid}/sentNotifications/${key}`);
      // Idempotent: create() fails if already claimed, so retries never double-send.
      try { await sentRef.create({ source_table: n.source, source_id: n.id, notify_at: n.notifyAt, sent_at: null }); }
      catch { continue; }
      const subs = await db.collection(`users/${n.uid}/push_subscriptions`).get();
      let ok = false;
      const fcm: Array<{ token: string; ref: any }> = [];
      for (const s of subs.docs) {
        const endpoint = s.get("endpoint") as string;
        const fcmToken = extractFcmToken(endpoint);
        if (fcmToken) { fcm.push({ token: fcmToken, ref: s.ref }); continue; }
        try {
          await webpush.sendNotification({ endpoint, keys: { p256dh: s.get("p256dh"), auth: s.get("auth") } },
            JSON.stringify({ title: n.title, body: n.body, url: n.url }));
          ok = true;
        } catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await s.ref.delete(); }
      }
      // Native installed app (FCM tokens): the scheduler used to skip
      // these entirely, so installed-app users never got due notifications.
      // Send them via the Admin SDK, same as announcement push.
      if (fcm.length) {
        const messaging = getMessaging();
        for (const batch of chunkTokens(fcm)) {
          const res = await messaging.sendEach(batch.map((b) => ({
            token: b.token,
            notification: { title: n.title, body: n.body },
            data: { url: n.url },
            android: { priority: "high" as const },
          })));
          for (let i = 0; i < batch.length; i++) {
            const r = res.responses[i];
            if (r.success) ok = true;
            else if (r.error?.code === "messaging/registration-token-not-registered" || r.error?.code === "messaging/invalid-registration-token") {
              await batch[i].ref.delete().catch(() => undefined);
            }
          }
        }
      }
      if (ok) await sentRef.update({ sent_at: new Date().toISOString() }); else await sentRef.delete(); // allow retry
    }
  });

// ---------------------------------------------------------------------------
// Admin announcements -> closed-app native push (STAGED, NOT DEPLOYED).
// Deploy gate: Cloud Functions cannot deploy on Spark. This trigger does
// NOTHING live until Blaze billing is active and `firebase deploy --only
// functions` runs. The in-app banner + popup (AnnouncementBanner) is the
// live path until then; do not promise closed-app push before that deploy.
// Behaviour: fires ONCE, on announcement creation, and only when the
// announcement is active at creation time. Editing an announcement or
// toggling it active later does NOT re-push (avoids duplicate pushes).
// Audience: "all" -> every user with a stored FCM token; "non_subscribers"
// -> only users whose users/{uid} doc has no subscription_plan_id.
// Tap action: the native client opens data.url — "/more" for offers (the
// plans card lives on MorePage), "/" for news. Invalid/expired tokens are
// deleted best-effort so the token list does not rot.
// NOTE: the sendNotifications scheduler above now ALSO sends due
// notifications via FCM for native-app tokens; this trigger remains the
// announcement-only path.
// ---------------------------------------------------------------------------
export const sendAnnouncementPush = onDocumentCreated(
  { document: "announcements/{announcementId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const a = snap.data() as Record<string, unknown>;
    if (a.is_active !== true) return;
    const title = typeof a.title === "string" && a.title ? a.title : "Driver Saathi";
    const body = typeof a.message === "string" ? a.message : "";
    const url = a.type === "offer" ? "/more" : "/";

    // Collect (token, subscription doc ref) pairs, filtered by audience.
    const tokenDocs: Array<{ token: string; ref: { delete: () => Promise<unknown> } }> = [];
    const usersSnap = await db.collection("users").get();
    for (const userDoc of usersSnap.docs) {
      if (!announcementMatchesAudience(a.audience, userDoc.get("subscription_plan_id"))) continue;
      const subsSnap = await db.collection(`users/${userDoc.id}/push_subscriptions`).get();
      for (const subDoc of subsSnap.docs) {
        const token = extractFcmToken(subDoc.get("endpoint"));
        if (token) tokenDocs.push({ token, ref: subDoc.ref });
      }
    }
    if (tokenDocs.length === 0) return;

    // Dedupe tokens (a user may have several devices); keep the first ref
    // for each token so invalid-token cleanup deletes the right doc.
    const byToken = new Map<string, { delete: () => Promise<unknown> }>();
    for (const t of tokenDocs) if (!byToken.has(t.token)) byToken.set(t.token, t.ref);
    const messaging = getMessaging();
    for (const batch of chunkTokens([...byToken.entries()])) {
      const res = await messaging.sendEach(
        batch.map(([token]) => ({
          token,
          notification: { title, body },
          data: { url, announcementId: event.params.announcementId, type: typeof a.type === "string" ? a.type : "news" },
          android: { priority: "high" },
        }))
      );
      // Best-effort cleanup of dead tokens, one doc per failed token.
      for (let i = 0; i < batch.length; i++) {
        const r = res.responses[i];
        if (!r.success && (r.error?.code === "messaging/registration-token-not-registered" || r.error?.code === "messaging/invalid-registration-token")) {
          await batch[i][1].delete().catch(() => undefined);
        }
      }
    }
  }
);

export const cleanupTransactions = onSchedule({ schedule: "0 3 * * *", timeZone: "Asia/Kolkata", region: REGION }, async () => {
  // CHANGED 2026-10-24 (audit): this job used to delete every
  // transaction older than 30 days, nightly — for a money app that
  // destroys the user's financial history. Transaction deletion is
  // REMOVED entirely. Only AI chat messages older than 24h are cleaned
  // (chat history, not money data). If a retention policy for other
  // data is ever wanted, it needs an explicit owner decision first.
  const writer = db.bulkWriter();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  (await db.collectionGroup("chat_messages").where("created_at", "<", dayAgo).get()).docs.forEach((d) => writer.delete(d.ref));
  await writer.close();
});
