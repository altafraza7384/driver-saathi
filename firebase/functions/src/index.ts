import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { getMessaging } from "firebase-admin/messaging";
import webpush from "web-push";
import { db, auth, requireUser, requireAdmin, deleteUserData } from "./shared";

export { chat, financeAi } from "./ai";

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

type Due = { uid: string; source: string; id: string; notifyAt: string; title: string; body: string; url: string };
const SOURCES: Array<[string, [string, unknown] | null, string, string]> = [
  ["reminders", ["is_completed", false], "🔔 Reminder: ", "/reminders"],
  ["debts", ["is_active", true], "💳 EMI due: ", "/debts"],
  ["goals", ["is_completed", false], "🎯 Goal: ", "/goals"],
  ["car_checks", ["is_completed", false], "🚗 Car check: ", "/car-checks"],
  ["car_documents", null, "📄 Document expiry: ", "/car-checks"],
  ["recurring_expenses", ["is_active", true], "🧾 Bill due: ", "/transactions"],
];

export const sendNotifications = onSchedule(
  { schedule: "every 5 minutes", region: REGION, secrets: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY], retryCount: 2 },
  async () => {
    webpush.setVapidDetails("mailto:noreply@driverbuddy.app", VAPID_PUBLIC_KEY.value(), VAPID_PRIVATE_KEY.value());
    const now = new Date();
    const from = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const due: Due[] = [];
    for (const [col, filter, prefix, url] of SOURCES) {
      let q = db.collectionGroup(col).where("notify_at", ">=", from).where("notify_at", "<=", now.toISOString());
      if (filter) q = q.where(filter[0], "==", filter[1]);
      for (const d of (await q.get()).docs) {
        const uid = d.ref.parent.parent!.id;
        const name = d.get("title") ?? d.get("name") ?? d.get("document_name") ?? d.get("check_type") ?? "";
        due.push({ uid, source: col, id: d.id, notifyAt: d.get("notify_at"), title: prefix + name, body: d.get("description") ?? "Due now", url });
      }
    }
    for (const n of due) {
      const key = `${n.source}_${n.id}_${n.notifyAt}`.replace(/[\/:.]/g, "-");
      const sentRef = db.doc(`users/${n.uid}/sentNotifications/${key}`);
      // Idempotent: create() fails if already claimed, so retries never double-send.
      try { await sentRef.create({ source_table: n.source, source_id: n.id, notify_at: n.notifyAt, sent_at: null }); }
      catch { continue; }
      const subs = await db.collection(`users/${n.uid}/push_subscriptions`).get();
      let ok = false;
      for (const s of subs.docs) {
        const endpoint = s.get("endpoint") as string;
        if (endpoint.startsWith("fcm://")) {
          const token = endpoint.slice(6);
          if (!token) { await s.ref.delete(); continue; }
          try {
            await getMessaging().send({
              token,
              notification: { title: n.title, body: n.body },
              data: { url: n.url, source: n.source, notificationId: key },
              android: { priority: "high", notification: { channelId: "driver_saathi_reminders", sound: "default" } },
            });
            ok = true;
          } catch (e: any) {
            const code = e?.code;
            if (code === "messaging/registration-token-not-registered" ||
                code === "messaging/invalid-registration-token") {
              await s.ref.delete();
            } else {
              console.error("FCM send failed", { code: code || "unknown" });
            }
          }
          continue;
        }
        try {
          await webpush.sendNotification({ endpoint, keys: { p256dh: s.get("p256dh"), auth: s.get("auth") } },
            JSON.stringify({ title: n.title, body: n.body, url: n.url }));
          ok = true;
        } catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await s.ref.delete(); }
      }
      if (ok) await sentRef.update({ sent_at: new Date().toISOString() }); else await sentRef.delete(); // allow retry
    }
  });

export const cleanupTransactions = onSchedule({ schedule: "0 3 * * *", timeZone: "Asia/Kolkata", region: REGION }, async () => {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const old = await db.collectionGroup("transactions").where("transaction_date", "<", cutoff.toISOString().slice(0, 10)).get();
  const writer = db.bulkWriter();
  old.docs.forEach((d) => writer.delete(d.ref));
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  (await db.collectionGroup("chat_messages").where("created_at", "<", dayAgo).get()).docs.forEach((d) => writer.delete(d.ref));
  await writer.close();
});
