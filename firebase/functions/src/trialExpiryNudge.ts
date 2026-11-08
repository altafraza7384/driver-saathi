import { onSchedule } from "firebase-functions/v2/scheduler";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "./shared";
import { chunkTokens, extractFcmToken } from "./announcements";

const REGION = "asia-south1";
const TIME_ZONE = "Asia/Kolkata";

// Trial expiry push v1 (soft): one push per milestone, gated by the
// subscription-nudges master flag (config/subscription_nudges, enabled).
// The scheduler runs daily at 10:00 IST. For each user with a trial
// (users doc has trial_ends_at), daysLeft uses the SAME ceil formula as
// src/lib/trial.ts. Milestones:
//   daysLeft === 1  -> 1 day before expiry
//   daysLeft === 0  -> expiry day
//   daysLeft === -2 -> 2 days after expiry
// Exactly-once per user per milestone: a trial_expiry_push_log doc is
// claimed in a transaction first (same shape as sos_push_log); if it
// already exists, skip. Paid users (subscription_plan_id set) and
// admins (roles/{uid} includes "admin", as in getAiLimits) are skipped.
// A tap opens /plans through the existing openPushUrl mechanism
// (src/lib/native-push.ts reads data.url), on the same "reminders"
// channel the sendNotifications pipeline already uses.
// Tokens come from users/{uid}/push_subscriptions and are deduped per
// token, exactly as in sendNotifications / sendAnnouncementPush.
// The flag is checked FIRST: if it is OFF or missing, NOTHING is sent
// to anyone.

function parseTrialDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const maybe = v as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === "function") {
    try { return maybe.toDate(); } catch { return null; }
  }
  if (typeof maybe.seconds === "number") return new Date(maybe.seconds * 1000);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

type Milestone = "1day" | "expiry" | "expired_2days";

function milestoneFor(daysLeft: number): { milestone: Milestone; body: string } | null {
  if (daysLeft === 1) {
    return {
      milestone: "1day",
      body: "Quick note: your free trial ends tomorrow. Tap to see plans and keep full AI.",
    };
  }
  if (daysLeft === 0) {
    return {
      milestone: "expiry",
      body: "Quick note: your free trial ends today. Tap to see plans and keep full AI.",
    };
  }
  if (daysLeft === -2) {
    return {
      milestone: "expired_2days",
      body: "Quick note: your free trial ended 2 days ago, so AI is now in limited mode. Tap to see plans and get full AI back.",
    };
  }
  return null;
}

async function sendTrialExpiryNudge(): Promise<void> {
  // Flag first: OFF or missing -> send nothing to anyone.
  const flagSnap = await db.doc("config/subscription_nudges").get();
  if (flagSnap.get("enabled") !== true) return;

  const now = new Date();
  const usersSnap = await db.collection("users").get();
  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data() ?? {};
    // Paid users never get a trial-expiry nudge.
    if (data.subscription_plan_id) continue;
    const ends = parseTrialDate(data.trial_ends_at);
    if (!ends) continue;
    // Same ceil formula as src/lib/trial.ts getTrialState.
    const daysLeft = Math.ceil((ends.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const hit = milestoneFor(daysLeft);
    if (!hit) continue;
    // Admins never get a trial-expiry nudge (as in getAiLimits).
    const role = await db.doc(`roles/${userDoc.id}`).get();
    if ((role.get("roles") as string[] | undefined)?.includes("admin")) continue;
    // Tokens first: if the user has no push tokens, do NOT claim the
    // milestone — claiming it here would lose this milestone forever
    // (no sent_at is ever written for a user with no tokens).
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
    // Exactly-once: claim the uid+milestone marker in a transaction.
    const logRef = db.doc(`trial_expiry_push_log/${userDoc.id}_${hit.milestone}`);
    let claimed = false;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(logRef);
      if (!existing.exists) {
        tx.set(logRef, {
          uid: userDoc.id,
          milestone: hit.milestone,
          days_left: daysLeft,
          claimed_at: new Date().toISOString(),
        });
        claimed = true;
      }
    });
    if (!claimed) continue;
    for (const batch of chunkTokens(tokens)) {
      const res = await getMessaging().sendEach(
        batch.map((token) => ({
          token,
          notification: { title: "Driver Saathi", body: hit.body },
          data: { url: "/plans" },
          android: { priority: "high", notification: { channelId: "reminders" } },
        })),
      );
      // Log failures only: a failed send must not throw the run, or a
      // retry would double-push the users that already got it.
      res.responses.forEach((r) => {
        if (!r.success) {
          console.error("trialExpiryNudge: send failed", {
            uid: userDoc.id,
            code: r.error?.code ?? "error",
          });
        }
      });
    }
    await logRef.set({ sent_at: new Date().toISOString() }, { merge: true });
  }
}

export const trialExpiryNudge = onSchedule(
  { schedule: "0 10 * * *", timeZone: TIME_ZONE, region: REGION },
  async () => {
    await sendTrialExpiryNudge();
  },
);
