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
 * The attempt key is DURABLE and PER-ATTEMPT: every Pay intention gets
 * its own localStorage entry, keyed by user + debt + attempt id and
 * written BEFORE the transaction starts. A retry of the SAME intention
 * (same form session, or the same amount after a reload) reuses its
 * id; a NEW intention always gets a fresh id. This replaces the old
 * single-slot design (`ds:pay-attempt:<user>:<debt>`), which had two
 * silent-drop bugs (round 4):
 *
 * (a) Failed cleanup dropped genuine payments. The first ₹100 recorded
 *     fine, but localStorage.removeItem (cleanup) failed, so the slot
 *     kept the stale attempt id. The next genuine ₹100 reused it, the
 *     transaction found the already-recorded doc and no-op'd — while
 *     the UI still said "payment recorded". Total stayed 100, expected
 *     200. Now each attempt has its OWN entry, so a failed cleanup
 *     strands at most that one attempt's entry; the next payment mints
 *     a fresh id. And when a pending attempt for the same amount IS
 *     found, the page reconciles it against the payment doc first
 *     (`getDebtPaymentByAttempt`): if the doc exists the user is told
 *     plainly ("Already recorded") and a NEW payment needs an explicit
 *     second tap — never a silent fresh id, never a stale-key success.
 *
 * (b) Two open web pages shared the one slot, so two genuine same-amount
 *     Pay actions reused one key — two success messages, one ₹100
 *     entry. Now each form session mints its own id (recorded with the
 *     session that created it), and a pending attempt is only ever
 *     reused by the session that created it. A foreign pending attempt
 *     is reconciled, never reused: if its doc does not exist yet it may
 *     still be in flight in the other tab, so the new tap mints a fresh
 *     id and both payments count.
 *
 * A changed amount never overwrites an unresolved old attempt: the old
 * attempt stays pending in the registry under its own id, and the new
 * amount gets a fresh id.
 *
 * If the key cannot be SAVED, the payment is aborted visibly and the
 * transaction never runs: proceeding with a fresh in-memory key would
 * risk double-recording after an uncertain failure. Likewise a storage
 * READ failure surfaces instead of silently pretending no attempt
 * exists. A failed/offline transaction shows an error only — never
 * success — and leaves no record and no balance move.
 *
 * No UI side effects happen inside the transaction callback (Firestore
 * may run it several times); toasts and query invalidation run only
 * after it resolves.
 *
 * Boundaries (honest limits of client-side idempotency, no server lock):
 * - A retry from a DIFFERENT tab while the first tab's transaction is
 *   still in flight cannot be told apart from a genuine second
 *   payment: the reconcile read finds no doc yet, so the second tap
 *   mints a fresh id and both taps count. Each tap was an explicit
 *   user action, so both counting is the safe side; a same-tab retry
 *   after the first tab reports its result is always deduped.
 * - Entries older than 24h are pruned on load: a dead tab's attempt is
 *   not retried a day later, and a stale entry never blocks a new
 *   payment. The payment doc itself stays the source of truth.
 * - The round-3 single-slot key is still READ (never written): an
 *   attempt left pending by that version is reconciled, not lost.
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

/* --------------------- durable per-attempt payment registry --------------------- */

/** One unfinished Pay attempt, as stored durably. `sessionId` is the
 *  form session that created it (fresh per form open); only that
 *  session may reuse it. `createdAt` is a local epoch-ms timestamp. */
export type PendingPaymentAttempt = {
  key: string;
  amount: number;
  sessionId: string;
  createdAt: number;
};

/** Entries older than this are pruned on load (dead tabs, stale
 *  attempts from a previous day). */
export const PENDING_ATTEMPT_MAX_AGE_MS = 24 * 3600 * 1000;

/**
 * localStorage key for one attempt — or, without an attempt key, the
 * shared prefix / legacy round-3 single-slot key
 * (`ds:pay-attempt:<user>:<debt>`). Each attempt gets its own key, so
 * two tabs saving concurrently never clobber each other's entry the
 * way a single shared slot did.
 */
export function paymentAttemptStorageKey(
  userId: string,
  debtId: string,
  attemptKey?: string,
): string {
  const base = `ds:pay-attempt:${userId}:${debtId}`;
  return attemptKey ? `${base}:${attemptKey}` : base;
}

function hasStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function parseStoredAttempt(
  key: string,
  raw: string,
): PendingPaymentAttempt | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { amount, sessionId, createdAt } = parsed as {
    amount?: unknown;
    sessionId?: unknown;
    createdAt?: unknown;
  };
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  if (sessionId !== undefined && typeof sessionId !== "string") return null;
  if (createdAt !== undefined && typeof createdAt !== "number") return null;
  return {
    key,
    amount,
    sessionId: typeof sessionId === "string" ? sessionId : "",
    createdAt: typeof createdAt === "number" ? createdAt : 0,
  };
}

/**
 * Read ALL unfinished Pay attempts for this debt, oldest first.
 * A corrupt entry is skipped (it must never crash the pay flow).
 * Entries older than 24h are pruned (best-effort removal). The legacy
 * round-3 single-slot value, if present, is surfaced as an attempt
 * with an unknown session, so it gets reconciled rather than lost.
 * THROWS when storage itself cannot be read — the caller must abort
 * visibly then, not silently pretend no attempt exists and mint a
 * fresh key.
 */
export function loadPendingPaymentAttempts(
  userId: string,
  debtId: string,
): PendingPaymentAttempt[] {
  if (!hasStorage()) return [];
  const prefix = `${paymentAttemptStorageKey(userId, debtId)}:`;
  const out: PendingPaymentAttempt[] = [];
  const staleKeys: string[] = [];
  const now = Date.now();
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (!storageKey || !storageKey.startsWith(prefix)) continue;
    const attemptKey = storageKey.slice(prefix.length);
    if (!attemptKey) continue;
    // A read throw propagates: the caller aborts visibly.
    const raw = localStorage.getItem(storageKey);
    if (!raw) continue;
    const attempt = parseStoredAttempt(attemptKey, raw);
    if (!attempt) continue;
    if (attempt.createdAt > 0 && now - attempt.createdAt > PENDING_ATTEMPT_MAX_AGE_MS) {
      staleKeys.push(storageKey);
      continue;
    }
    out.push(attempt);
  }
  // Legacy round-3 single slot (never written by this version).
  const legacyRaw = localStorage.getItem(paymentAttemptStorageKey(userId, debtId));
  if (legacyRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(legacyRaw);
    } catch {
      parsed = null;
    }
    if (typeof parsed === "object" && parsed !== null) {
      const { key, amount } = parsed as { key?: unknown; amount?: unknown };
      if (typeof key === "string" && key.length > 0 && typeof amount === "number" && Number.isFinite(amount)) {
        if (!out.some((a) => a.key === key)) {
          out.push({ key, amount, sessionId: "", createdAt: 0 });
        }
      }
    }
  }
  for (const staleKey of staleKeys) {
    try {
      localStorage.removeItem(staleKey);
    } catch {
      // Best-effort pruning: a leftover stale entry is simply
      // excluded from the result and pruned again next load.
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Persist one attempt BEFORE its transaction starts, under its own
 * key — never overwriting another attempt. Returns false when storage
 * throws (quota / unavailable) — the caller must abort the payment
 * visibly then, never proceed with an unsaved key.
 */
export function savePendingPaymentAttempt(
  userId: string,
  debtId: string,
  key: string,
  amount: number,
  sessionId = "",
): boolean {
  if (!hasStorage()) return false;
  try {
    localStorage.setItem(
      paymentAttemptStorageKey(userId, debtId, key),
      JSON.stringify({ amount, sessionId, createdAt: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear ONE stored attempt — only once its transaction has fully
 * succeeded, or once its payment doc has been reconciled as recorded.
 * Best-effort: a clear failure never fails the payment. The entry
 * simply stays pending, and the next Pay tap reconciles it again
 * instead of silently reusing or dropping it.
 */
export function clearPendingPaymentAttempt(userId: string, debtId: string, key: string): void {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(paymentAttemptStorageKey(userId, debtId, key));
  } catch {
    // See the header: a leftover entry is reconciled on the next tap.
  }
  try {
    // A legacy single-slot entry for the same attempt id goes too.
    const legacyRaw = localStorage.getItem(paymentAttemptStorageKey(userId, debtId));
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as { key?: unknown };
      if (parsed?.key === key) {
        localStorage.removeItem(paymentAttemptStorageKey(userId, debtId));
      }
    }
  } catch {
    // Best-effort, same as above.
  }
}
