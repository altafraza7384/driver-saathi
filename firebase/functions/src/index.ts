import "./globalOptions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { announcementMatchesAudience, extractFcmToken, chunkTokens } from "./announcements";
import { defineSecret } from "firebase-functions/params";
import webpush from "web-push";
import { db, auth, requireUser, requireAdmin, deleteUserData } from "./shared";
import { notifyQueryBounds, isDueNow } from "./notifyTime";
import { toNotifLang, reminderTitle, dueDetail, type NotifLang } from "./notifLang";

export { chat, financeAi } from "./ai";
export { createRazorpaySubscription, confirmRazorpaySubscription, cancelRazorpaySubscription, getSubscriptionStatus } from "./razorpay";
import { cancelSubscriptionForUser, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "./razorpay";
export { razorpayWebhook } from "./webhook";
export { dedupeInsuranceLead } from "./leads";
export { sendSosRequestPush, sendSosCancelPush } from "./sosPush";
export { clearPhoneVerifiedOnChange } from "./mechanicPhone";

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

export const deleteAccount = onCall({ region: REGION, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (req) => {
  const uid = requireUser(req);
  if (req.data?.confirm !== "DELETE") throw new HttpsError("invalid-argument", "Confirmation required");
  await cancelSubscriptionForUser(uid);
  await deleteUserData(uid);
  await auth.deleteUser(uid);
  return { success: true };
});
export const adminDeleteUser = onCall({ region: REGION, secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (req) => {
    const adminUid = await requireAdmin(req);
    const targetUid = req.data?.uid;
    if (typeof targetUid !== "string" || !targetUid) throw new HttpsError("invalid-argument", "User id required");
    if (targetUid === adminUid) throw new HttpsError("permission-denied", "Admins cannot delete their own account");
    if (req.data?.confirm !== "DELETE") throw new HttpsError("invalid-argument", "Confirmation required");
    const target = await auth.getUser(targetUid).catch(() => null);
    if (!target) throw new HttpsError("not-found", "User not found");
    // Never delete the owner's own accounts or another admin's account,
    // even if the admin panel row was clicked by mistake.
    const OWN_ACCOUNTS = ["altafraza7384@gmail.com", "razakhan.chino@gmail.com", "contentraza5@gmail.com"];
    if (target.email && OWN_ACCOUNTS.includes(target.email.toLowerCase())) {
          throw new HttpsError("permission-denied", "This account cannot be deleted");
    }
    const role = await db.doc(`roles/${targetUid}`).get();
    if (role.get("roles")?.includes("admin"))  throw new HttpsError("permission-denied", "Admin accounts cannot be deleted");
    await cancelSubscriptionForUser(targetUid);
    await deleteUserData(targetUid);
    await auth.deleteUser(targetUid);
    return { success: true };
});

export const adminDeleteMechanic = onCall({ region: REGION }, async (req) => {
  await requireAdmin(req);
  const targetUid = req.data?.uid;
  if (typeof targetUid !== "string" || !targetUid) throw new HttpsError("invalid-argument", "Mechanic id required");
  if (req.data?.confirm !== "DELETE") throw new HttpsError("invalid-argument", "Confirmation required");
  const doc = await db.doc(`mechanics/${targetUid}`).get();
  if (!doc.exists) throw new HttpsError("not-found", "Mechanic not found");
  // No self/owner block here (unlike adminDeleteUser): the admin's own
  // mechanic profile is a test profile and may be deleted on purpose. The
  // DELETE-word confirm is the guard against a mistaken click, and the
  // profile is recoverable by saving it again in the Mechanic app.
  // A mechanic with a live SOS request must not be deleted: the driver would
  // be left assigned to a mechanic that no longer exists. Query by mechanicId
  // only (no composite index needed) and filter the status in code.
  const mine = await db.collection("sos_requests").where("mechanicId", "==", targetUid).get();
  const live = mine.docs.some((d) => ["pending", "accepted", "onway", "arrived"].includes(d.get("status") ?? ""));
  if (live) throw new HttpsError("failed-precondition", "Mechanic has a live SOS request");
  // Only the mechanic profile is deleted. The same uid keeps its Driver
  // account and Firebase login; completed-job history in sos_requests stays.
  await db.doc(`mechanics/${targetUid}`).delete();
  return { success: true };
});

type Due = { uid: string; source: string; id: string; notifyAt: string; title: string; body: string; url: string; item: string; label: string; desc: string | null; amount: number | null };
// Notification title/body are localized per user (see notifLang.ts):
// title = saved name + " Reminder" in the user's language (or the type
// when the item has no name). No emoji: the shade reads cleaner that way.
const SOURCES: Array<[string, [string, unknown] | null, string, string]> = [
  ["reminders", null, "/reminders", "reminder"],
  ["debts", ["is_active", true], "/debts", "EMI"],
  ["goals", ["is_completed", false], "/goals", "goal"],
  ["car_checks", ["is_completed", false], "/car-checks", "car check"],
  ["car_documents", null, "/car-checks", "document"],
  ["recurring_expenses", ["is_active", true], "/debts", "bill"],
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
    // The range is widened by the IST offset so page-written naive IST
    // times ("2026-11-02T04:28:00") are fetched too; isDueNow() then reads
    // both shapes as real instants (they used to fire 5h30m late).
    const { from, to } = notifyQueryBounds(now);
    const due: Due[] = [];
    for (const [col, filter, url, label] of SOURCES) {
      let q = db.collectionGroup(col).where("notify_at", ">=", from).where("notify_at", "<=", to);
      if (filter) q = q.where(filter[0], "==", filter[1]);
      // One failing source (e.g. a missing collection-group index) must not
      // stop every other source from sending; the error names the source.
      let docs;
      try { docs = (await q.get()).docs; }
      catch (e: any) {
        console.error("sendNotifications: query failed", { source: col, code: e?.code ?? null, message: String(e?.message ?? e).slice(0, 500) });
        continue;
      }
      for (const d of docs) {
        if (!isDueNow(d.get("notify_at"), now)) continue;
        // Reminders: skip completed in code, not in the query — docs
        // created from the page before the fix carry no is_completed
        // field, and Firestore equality does not match missing fields.
        if (col === "reminders" && d.get("is_completed") === true) continue;
        const uid = d.ref.parent.parent!.id;
        const name = d.get("title") ?? d.get("name") ?? d.get("document_name") ?? d.get("check_type") ?? "";
        // The title is set below, once the user's language is known
        // (it needs the users doc, read in the next loop).
        const amountRaw = d.get("emi_amount") ?? d.get("amount") ?? d.get("target_amount") ?? null;
        const amount = typeof amountRaw === "number" && Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;
        due.push({ uid, source: col, id: d.id, notifyAt: d.get("notify_at"), title: "", body: "", url, item: String(name), label, desc: ((d.get("description") ?? d.get("note")) as string | null) ?? null, amount });
      }
    }
    // Rich, CRED-style body: first name + detail, so the shade shows a
    // personal message instead of a bare "Due now". Title and body are in
    // the user's own language (preferred_language from their profile doc;
    // English when it was never saved). A missing profile/name falls back
    // to the detail sentence alone.
    const firstNames = new Map<string, string>();
    const langs = new Map<string, NotifLang>();
    for (const n of due) {
      if (!firstNames.has(n.uid)) {
        let first = "";
        let lang: NotifLang = "en";
        try {
          const snap = await db.doc(`users/${n.uid}`).get();
          const full = snap.exists ? (snap.get("full_name") as string | null) : null;
          first = (full ?? "").trim().split(/\s+/)[0] ?? "";
          lang = toNotifLang(snap.get("preferred_language"));
        } catch { first = ""; }
        firstNames.set(n.uid, first);
        langs.set(n.uid, lang);
      }
      const who = firstNames.get(n.uid);
      const lang = langs.get(n.uid) ?? "en";
      n.title = reminderTitle(lang, n.item, n.label);
      // Amount first (like the Jio example's "pack of Rs.349"): the EMI/bill
      // amount when the record has one, else the saved description/note,
      // else the plain due line.
      const detail = dueDetail(lang, n.label, n.item, n.amount, n.desc);
      n.body = who ? `${who}, ${detail}` : detail;
    }
    // One log line per item and per run (never the token itself), so
    // "was it sent, to how many devices, and why not" is answerable from
    // Logs Explorer without reading Firestore.
    const summary = { due: due.length, sent: 0, alreadySent: 0, noDevices: 0, failed: 0 };
    for (const n of due) {
      const key = `${n.source}_${n.id}_${n.notifyAt}`.replace(/[/:.]/g, "-");
      const sentRef = db.doc(`users/${n.uid}/sentNotifications/${key}`);
      // Idempotent: create() fails if already claimed, so retries never double-send.
      // A claim with sent_at set was truly sent. A claim with sent_at null means
      // a previous run died mid-item — delete the stale claim and re-claim it
      // so this run retries the item instead of skipping it forever.
      try { await sentRef.create({ source_table: n.source, source_id: n.id, notify_at: n.notifyAt, sent_at: null }); }
      catch {
        const existing = await sentRef.get().catch(() => null);
        if (existing?.exists && existing.get("sent_at")) { summary.alreadySent++; continue; }
        await sentRef.delete().catch(() => undefined);
        try { await sentRef.create({ source_table: n.source, source_id: n.id, notify_at: n.notifyAt, sent_at: null }); }
        catch { summary.alreadySent++; continue; }
      }
      const subs = await db.collection(`users/${n.uid}/push_subscriptions`).get();
      let ok = false;
      const result = { fcmTokens: 0, webSubs: 0, fcmOk: 0, webOk: 0, errors: [] as string[] };
      const fcm: Array<{ token: string; ref: any }> = [];
      for (const s of subs.docs) {
        const endpoint = s.get("endpoint") as string;
        const fcmToken = extractFcmToken(endpoint);
        if (fcmToken) { fcm.push({ token: fcmToken, ref: s.ref }); continue; }
        result.webSubs++;
        try {
          await webpush.sendNotification({ endpoint, keys: { p256dh: s.get("p256dh"), auth: s.get("auth") } },
            JSON.stringify({ title: n.title, body: n.body, url: n.url }));
          ok = true; result.webOk++;
        } catch (e: any) {
          result.errors.push(`web:${e?.statusCode ?? "error"}`);
          if (e?.statusCode === 404 || e?.statusCode === 410) await s.ref.delete();
        }
      }
      // Dedupe tokens: a user can hold several push_subscriptions docs
      // with the SAME token (reinstall/re-registration), and sending to
      // each doc delivered the same notification twice to one phone
      // (seen 2026-11-02, again 2026-11-04). Keep the first doc per token
      // so invalid-token cleanup still deletes the right doc.
      const uniqueFcm: Array<{ token: string; ref: any }> = [];
      const seenTokens = new Set<string>();
      for (const b of fcm) {
        if (seenTokens.has(b.token)) continue;
        seenTokens.add(b.token);
        uniqueFcm.push(b);
      }
      result.fcmTokens = uniqueFcm.length;
      // Native installed app (FCM tokens): the scheduler used to skip
      // these entirely, so installed-app users never got due notifications.
      // Send them via the Admin SDK, same as announcement push.
      if (uniqueFcm.length) {
        const messaging = getMessaging();
        for (const batch of chunkTokens(uniqueFcm)) {
          const res = await messaging.sendEach(batch.map((b) => ({
            token: b.token,
            notification: { title: n.title, body: n.body },
            data: { url: n.url },
            // "reminders" is the high-importance channel the app creates
            // (heads-up + sound). On an older install without it, Android's
            // FCM SDK falls back to its default channel, so nothing is lost.
            android: { priority: "high" as const, notification: { channelId: "reminders", sound: "default" } },
          })));
          for (let i = 0; i < batch.length; i++) {
            const r = res.responses[i];
            if (r.success) { ok = true; result.fcmOk++; }
            else {
              result.errors.push(`fcm:${r.error?.code ?? "error"}`);
              if (r.error?.code === "messaging/registration-token-not-registered" || r.error?.code === "messaging/invalid-registration-token") {
                await batch[i].ref.delete().catch(() => undefined);
              }
            }
          }
        }
      }
      if (ok) summary.sent++; else if (!subs.size) summary.noDevices++; else summary.failed++;
      console.log("sendNotifications: item", { uid: n.uid, source: n.source, id: n.id, notify_at: n.notifyAt,
        outcome: ok ? "sent" : subs.size ? "failed" : "no_devices", ...result });
      if (ok) await sentRef.update({ sent_at: new Date().toISOString() }); else await sentRef.delete(); // allow retry
    }
    console.log("sendNotifications: run", { at: now.toISOString(), ...summary });
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
    // Exactly-once: claim this announcement in a transaction. A throw after
    // some batches makes the trigger retry — without a claim the retry would
    // re-push to everyone. A claim with sent:true is skipped; a claim with
    // sent:false (crashed mid-send) is re-attempted, like sos_push_log.
    const logRef = db.doc(`announcement_push_log/${event.params.announcementId}`);
    let alreadySent = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(logRef);
      if (!existing.exists) {
        tx.set(logRef, { announcementId: event.params.announcementId, claimed_at: new Date().toISOString(), sent: false });
      } else if (existing.get("sent") === true) {
        alreadySent = true;
      }
    });
    if (alreadySent) return;
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
    await logRef.set({ sent: true, sent_at: new Date().toISOString() }, { merge: true });
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
  // AI quota buckets are hourly and only the current hour is ever read —
  // delete buckets older than 48h so they do not accumulate forever.
  const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);
  (await db.collectionGroup("aiUsage").where("bucket_start", "<", twoDaysAgo).get()).docs.forEach((d) => writer.delete(d.ref));
  await writer.close();
});
export { earningsNudgeAfternoon, earningsNudgeNight } from "./earningsNudge";
export { trialExpiryNudge } from "./trialExpiryNudge";
