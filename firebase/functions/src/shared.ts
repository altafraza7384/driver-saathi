import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, CallableRequest } from "firebase-functions/v2/https";

if (!getApps().length) initializeApp();
export const db = getFirestore();
export const auth = getAuth();
export { FieldValue };

export const USER_COLLECTIONS = [
  "recurring_expense_payments", "recurring_expenses", "debt_payments", "push_subscriptions",
  "chat_messages", "emergency_contacts", "car_documents", "car_checks", "health_logs", "notes",
  "reminders", "goals", "debts", "transactions", "platform_affiliations", "aiUsage", "sentNotifications",
  "budgets",
] as const;

export function requireUser(req: CallableRequest): string {
  if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required");
  return req.auth.uid;
}

/** Admin check: custom claim OR server-side roles doc (either grants).
    The old code required BOTH, while Firestore isAdmin() accepts either
    — admins granted via roles doc only were rejected here (audit
    2026-10-24). */
export async function requireAdmin(req: CallableRequest): Promise<string> {
  const uid = requireUser(req);
  const role = await db.doc(`roles/${uid}`).get();
  if (req.auth?.token.admin !== true && !role.get("roles")?.includes("admin")) {
    throw new HttpsError("permission-denied", "Admin only");
  }
  return uid;
}

/** Atomic hourly quota, equivalent to public.consume_ai_quota. */
export async function consumeQuota(uid: string, feature: string, limit: number): Promise<boolean> {
  const bucket = new Date(); bucket.setUTCMinutes(0, 0, 0);
  const ref = db.doc(`users/${uid}/aiUsage/${feature}_${bucket.toISOString()}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.get("request_count") as number | undefined) ?? 0;
    if (count >= limit) return false;
    tx.set(ref, { feature, bucket_start: bucket, request_count: count + 1 }, { merge: true });
    return true;
  });
}

/** Trial + plan based AI limits, approved 2026-10-31.
 *  Trial (7 days from first AI use): chat 100/h, finance-ai 20/h.
 *  Paid (subscription_plan_id set) or admin: chat 100/h, finance-ai 50/h.
 *  After trial, no plan: chat 10/h, finance-ai 5/h (core app stays free).
 *  Trial dates are SERVER-ONLY: firestore.rules denies clients writing
 *  trial_started_at/trial_ends_at, so a user can never extend their own
 *  trial. First AI use starts the trial (covers legacy users with no dates
 *  and new signups alike — no signup-code change needed).
 */
export interface AiLimits { chat: number; financeAi: number; }

export async function getAiLimits(uid: string): Promise<AiLimits> {
  const role = await db.doc(`roles/${uid}`).get();
  if ((role.get("roles") as string[] | undefined)?.includes("admin")) {
    return { chat: 100, financeAi: 50 };
  }
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() ?? {};
  if (data.subscription_plan_id) return { chat: 100, financeAi: 50 };
  const now = new Date();
  const ends = toDate(data.trial_ends_at);
  if (ends && now < ends) return { chat: 100, financeAi: 20 };
  if (!ends) {
    const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await db.doc(`users/${uid}`).set({ trial_started_at: now, trial_ends_at: endsAt }, { merge: true });
    return { chat: 100, financeAi: 20 };
  }
  return { chat: 10, financeAi: 5 };
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const maybe = v as { toDate?: () => Date };
  if (typeof maybe.toDate === "function") {
    try { return maybe.toDate(); } catch { return null; }
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function deleteUserData(uid: string): Promise<void> {
  for (const c of USER_COLLECTIONS) await db.recursiveDelete(db.collection(`users/${uid}/${c}`));
  // Top-level collections keyed by owner: without this, account delete
  // left insurance leads (phone/vehicle) and SOS requests/details
  // (phone + exact location) behind (audit 2026-10-24).
  const writer = db.bulkWriter();
  const insurance = await db.collection("insurance_leads").where("user_id", "==", uid).get();
  insurance.docs.forEach((d) => writer.delete(d.ref));
  const sos = await db.collection("sos_requests").where("driverId", "==", uid).get();
  sos.docs.forEach((d) => writer.delete(d.ref));
  const sosDetails = await db.collection("sos_request_details").where("driverId", "==", uid).get();
  sosDetails.docs.forEach((d) => writer.delete(d.ref));
  await writer.close();
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await db.doc(`roles/${uid}`).delete();
}
