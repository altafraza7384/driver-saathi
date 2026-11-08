import { onSchedule } from "firebase-functions/v2/scheduler";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "./shared";
import { chunkTokens, extractFcmToken } from "./announcements";
import { toNotifLang, nudgeTitle, nudgeBody } from "./notifLang";

const REGION = "asia-south1";
const TIME_ZONE = "Asia/Kolkata";

// Earnings-entry nudge v1 (user-approved): remind opted-in drivers to
// record income, ONLY when an entry is missing. The opt-in flag lives on
// the user's existing profiles doc (users/{uid} in Firestore) as
// earnings_nudge_enabled. It is OFF by default: a missing field is treated
// as false, so nobody is nudged unless they turned the toggle on in
// Settings. No new collection is created, and no reminder push, Home
// query or billing logic is changed.
//
// Afternoon check (15:00 IST): yesterday's income missing -> one nudge.
// Night check (21:30 IST): today's income missing -> one nudge.
// A tap opens /transactions/add through the existing openPushUrl
// mechanism (src/lib/native-push.ts reads data.url), on the same
// "reminders" channel the sendNotifications pipeline already uses.
// Tokens come from users/{uid}/push_subscriptions and are deduped per
// token, exactly as in sendNotifications / sendAnnouncementPush.

// Today's date in Asia/Kolkata (YYYY-MM-DD), regardless of the
// function's server timezone.
function istDateString(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function hasIncomeOn(uid: string, date: string): Promise<boolean> {
  const snap = await db
    .collection(`users/${uid}/transactions`)
    .where("type", "==", "income")
    .where("transaction_date", "==", date)
    .limit(1)
    .get();
  return !snap.empty;
}

async function sendEarningsNudge(targetDate: string, when: "yesterday" | "today"): Promise<void> {
  const usersSnap = await db.collection("users").get();
  for (const userDoc of usersSnap.docs) {
    if (userDoc.get("earnings_nudge_enabled") !== true) continue;
    if (await hasIncomeOn(userDoc.id, targetDate)) continue;
    const subsSnap = await db
      .collection(`users/${userDoc.id}/push_subscriptions`)
      .get();
    const tokens = [
      ...new Set(
        subsSnap.docs
          .map((d) => extractFcmToken(d.get("endpoint")))
          .filter((t): t is string => t !== null),
      ),
    ];
    if (tokens.length === 0) continue;
    // The nudge speaks the user's own language (preferred_language from
    // their profile doc; English when it was never saved).
    const lang = toNotifLang(userDoc.get("preferred_language"));
    const title = nudgeTitle(lang);
    const body = nudgeBody(lang, when);
    for (const batch of chunkTokens(tokens)) {
      await getMessaging().sendEach(
        batch.map((token) => ({
          token,
          notification: { title, body },
          data: { url: "/transactions/add" },
          android: { priority: "high", notification: { channelId: "reminders" } },
        })),
      );
    }
  }
}

export const earningsNudgeAfternoon = onSchedule(
  { schedule: "0 15 * * *", timeZone: TIME_ZONE, region: REGION },
  async () => {
    await sendEarningsNudge(
      addDays(istDateString(new Date()), -1),
      "yesterday",
    );
  },
);

export const earningsNudgeNight = onSchedule(
  { schedule: "30 21 * * *", timeZone: TIME_ZONE, region: REGION },
  async () => {
    await sendEarningsNudge(
      istDateString(new Date()),
      "today",
    );
  },
);
