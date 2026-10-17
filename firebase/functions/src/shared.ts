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
] as const;

export function requireUser(req: CallableRequest): string {
  if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required");
  return req.auth.uid;
}

/** Admin check: custom claim AND server-side roles doc (defence in depth). */
export async function requireAdmin(req: CallableRequest): Promise<string> {
  const uid = requireUser(req);
  const role = await db.doc(`roles/${uid}`).get();
  if (req.auth?.token.admin !== true || !role.get("roles")?.includes("admin")) {
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

export async function deleteUserData(uid: string): Promise<void> {
  for (const c of USER_COLLECTIONS) await db.recursiveDelete(db.collection(`users/${uid}/${c}`));
  await db.recursiveDelete(db.doc(`users/${uid}`));
  await db.doc(`roles/${uid}`).delete();
}
