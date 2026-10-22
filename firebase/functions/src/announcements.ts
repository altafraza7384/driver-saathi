// Pure helpers for admin announcements -> closed-app native push.
//
// STAGED ONLY — DO NOT DEPLOY ON SPARK. Cloud Functions cannot deploy
// on the Spark plan at all, so `sendAnnouncementPush` (in index.ts) does
// nothing live until Blaze billing is active. The in-app banner + popup
// (AnnouncementBanner) is the live path until then; this file only keeps
// the push side code-ready so Blaze day is a deploy, not a rebuild.
//
// Security: FCM is sent ONLY from this server function via the Admin SDK.
// No FCM server key ever goes into client code, and no client ever sends
// a push directly — an admin creating an announcement is the only trigger.

export type AnnouncementDoc = {
  title?: unknown;
  message?: unknown;
  type?: unknown;
  audience?: unknown;
  is_active?: unknown;
};

/** Audience filter for push: "all" reaches every user with a token;
 *  "non_subscribers" reaches only users whose users/{uid} doc has no
 *  subscription_plan_id (null or empty). Any other value matches nobody,
 *  so a typo'd audience can never broadcast by accident. */
export function announcementMatchesAudience(audience: unknown, subscriptionPlanId: unknown): boolean {
  if (audience === "all") return true;
  if (audience === "non_subscribers") return subscriptionPlanId == null || subscriptionPlanId === "";
  return false;
}

/** Native push subscriptions are stored as endpoint `fcm://<token>`
 *  (see src/lib/native-push.ts). Web push endpoints (https://...) are
 *  NOT FCM tokens and must never be handed to the Admin messaging SDK. */
export function extractFcmToken(endpoint: unknown): string | null {
  if (typeof endpoint !== "string") return null;
  if (!endpoint.startsWith("fcm://")) return null;
  const token = endpoint.slice("fcm://".length);
  return token ? token : null;
}

/** Chunk an array into batches of at most `size` (FCM sendEach limit). */
export function chunkTokens<T>(tokens: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < tokens.length; i += size) out.push(tokens.slice(i, i + size));
  return out;
}
