import { toAmount } from "@/lib/currency";

/**
 * Debt payments: one payment record + one balance update, made
 * atomic/idempotent without a server transaction (Firestore has no
 * client-side transaction across these two writes from this adapter).
 *
 * The payment row is written with a DETERMINISTIC doc id derived from a
 * per-attempt idempotency key: the adapter maps a payload `id` to the
 * Firestore doc id (setDoc), so a retry that reuses the same key
 * overwrites the same payment doc instead of inserting a second row.
 * The key lives in the page for the duration of one unfinished Pay
 * attempt — it is created on the first Pay tap, REUSED on retry after
 * an intermediate failure, and cleared only when the whole payment
 * (record + balance) succeeds. A new payment after success gets a
 * fresh key, so genuine repeat payments still get their own rows.
 *
 * Boundary: abandoning the pay form mid-attempt (closing it, paying a
 * different debt) drops the key, so a later retry mints a new one and
 * the orphaned first record stays. That needs a server-side
 * reconciliation, not a client key.
 */

/** Deterministic payment doc id for one Pay attempt. */
export function debtPaymentId(debtId: string, attemptKey: string): string {
  return `dp_${debtId}_${attemptKey}`;
}

/** Fresh idempotency key for one Pay attempt: time + randomness, so
 *  two separate payments never share a key even in the same
 *  millisecond. The key itself carries no "/" (illegal in a doc id). */
export function newPaymentAttemptKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Balance outcome of recording `amount` against a debt. */
export function planDebtPayment(
  debt: { principal: number; total_paid: number },
  amount: number,
): { newTotalPaid: number; isFullyPaid: boolean } {
  const newTotalPaid = toAmount(debt.total_paid) + amount;
  return { newTotalPaid, isFullyPaid: newTotalPaid >= toAmount(debt.principal) };
}
