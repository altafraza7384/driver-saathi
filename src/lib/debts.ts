import { toAmount } from "@/lib/currency";

/**
 * Debt payments: one payment record + one balance update, committed in
 * ONE Firestore client transaction
 * (`recordDebtPaymentInTransaction` in
 * src/integrations/firebase/adapter.ts) — or rolled back together.
 *
 * Inside that transaction, Firestore reads the debt doc AND the payment
 * doc for this attempt BEFORE writing anything:
 * - the balance is computed from the LATEST server total_paid, not the
 *   page's possibly stale copy, so two concurrent DIFFERENT payments
 *   both count (contention re-runs the transaction function, which
 *   re-reads the balance — no lost update);
 * - if a payment doc with this attempt's deterministic id already
 *   exists, the attempt already committed (an earlier try whose result
 *   was uncertain, or a retry after remount/reload) and the transaction
 *   returns the stored outcome WITHOUT writing again, so a same-attempt
 *   retry never increments the balance a second time.
 *
 * The attempt key is DURABLE: it lives in localStorage, keyed by user +
 * debt, written BEFORE the transaction starts and cleared ONLY when the
 * transaction has fully succeeded. A page unmount, navigation, or reload
 * therefore cannot lose it — the retry after coming back reuses the same
 * key and the same payment doc. A new payment after success gets a fresh
 * key, so genuine repeat payments still get their own rows.
 *
 * If the key cannot be SAVED, the payment is aborted visibly and the
 * transaction never runs: proceeding with a fresh in-memory key would
 * risk double-recording after an uncertain failure. Likewise a storage
 * READ failure surfaces instead of silently pretending no attempt
 * exists. The only residual gap is a caller that deliberately changes
 * the amount mid-attempt (a new key is minted for the new amount);
 * re-paying the OLD amount afterwards would be a new payment, which is
 * why the pay form prefills the pending attempt's amount.
 *
 * No UI side effects happen inside the transaction callback (Firestore
 * may run it several times); toasts and query invalidation run only
 * after it resolves. A failed/offline transaction shows an error only —
 * never success — and leaves no record and no balance move.
 *
 * Boundary: two tabs paying the SAME debt the SAME amount at the same
 * instant share one localStorage slot, so the second tab reuses the
 * first tab's key and the two taps are treated as ONE attempt (one row,
 * counted once) rather than two payments. Different amounts, different
 * debts, and different devices (separate storage) always get separate
 * keys and both count. That needs a server-side reconciliation, not a
 * client key.
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

/* --------------------- durable pending-payment attempt --------------------- */

/** One unfinished Pay attempt, as stored durably. */
export type PendingPaymentAttempt = { key: string; amount: number };

/** localStorage slot for the unfinished Pay attempt on one debt. */
export function paymentAttemptStorageKey(userId: string, debtId: string): string {
  return `ds:pay-attempt:${userId}:${debtId}`;
}

function hasStorage(): boolean {
  return typeof localStorage !== "undefined";
}

/**
 * Read the unfinished Pay attempt for this debt, if one was saved.
 * Returns null when there is none, or when the stored value is corrupt
 * (a corrupt slot must never crash the pay flow). THROWS when storage
 * itself cannot be read — the caller must abort visibly then, not
 * silently pretend no attempt exists and mint a fresh key.
 */
export function loadPendingPaymentAttempt(
  userId: string,
  debtId: string,
): PendingPaymentAttempt | null {
  if (!hasStorage()) return null;
  const raw = localStorage.getItem(paymentAttemptStorageKey(userId, debtId));
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { key, amount } = parsed as { key?: unknown; amount?: unknown };
  if (typeof key !== "string" || key.length === 0) return null;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return { key, amount };
}

/**
 * Persist the attempt BEFORE the transaction starts. Returns false
 * when storage throws (quota / unavailable) — the caller must abort
 * the payment visibly then, never proceed with an unsaved key.
 */
export function savePendingPaymentAttempt(
  userId: string,
  debtId: string,
  key: string,
  amount: number,
): boolean {
  if (!hasStorage()) return false;
  try {
    localStorage.setItem(
      paymentAttemptStorageKey(userId, debtId),
      JSON.stringify({ key, amount }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the stored attempt — only once the transaction has fully
 * succeeded. Best-effort: a clear failure never fails the payment.
 */
export function clearPendingPaymentAttempt(userId: string, debtId: string): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(paymentAttemptStorageKey(userId, debtId));
  } catch {
    // The payment already succeeded; a leftover slot only means a later
    // Pay tap for the same amount would reuse the key — and the
    // transaction would then find the already-recorded payment and
    // no-op, so this is safe to ignore.
  }
}
