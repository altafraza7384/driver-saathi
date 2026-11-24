import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import DebtsPage from "./DebtsPage";

afterEach(cleanup);

// In-memory stand-in for the debts / debt_payments collections. Insert
// honours a payload `id` the way the real adapter does (setDoc with
// that id overwrites the same doc); without an id it mints a fresh one.
type Row = Record<string, any>;
const mockStore: Record<string, Row[]> = { debts: [], debt_payments: [] };
const mockInsertCalls: Array<{ table: string; row: unknown }> = [];
const mockTransactionCalls: Array<{ debtId: string; attemptKey: string; amount: number }> = [];
const mockGetByAttemptCalls: Array<{ debtId: string; attemptKey: string }> = [];
let mockGenId = 0;
// Failure injection, shared by BOTH seams so the same test reproduces
// the bug on the old two-write code and verifies the fix on the new
// transaction code:
//  - mockFailUpdateDebts: the balance write fails. Old code: the payment
//    insert lands, the update errors — an orphaned payment doc with
//    total_paid 0. New code: the transaction throws BEFORE applying
//    anything (atomic rollback: no doc, no balance move).
//  - mockFailUpdateDebtsAfterApply: the write lands but the client is
//    told it failed (uncertain outcome — e.g. the response was lost).
//    Old code: the update applies, then errors. New code: the
//    transaction applies, then throws, so the retry must find the
//    already-committed payment instead of recording it again.
let mockFailUpdateDebts = false;
let mockFailUpdateDebtsAfterApply = false;
// Fail the NEXT transaction call only (clean failure, nothing applied).
let mockFailTransactionNext = false;

vi.mock("@/lib/backend", () => ({
  db: {
    from: (table: string) => ({
      select: () => {
        const p: any = Promise.resolve({ data: [...(mockStore[table] ?? [])], error: null });
        p.order = () => p;
        p.eq = () => p;
        return p;
      },
      insert: (row: any) => {
        mockInsertCalls.push({ table, row });
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) {
          const id = r.id ?? `gen-${++mockGenId}`;
          const stored = { ...r, id };
          const idx = (mockStore[table] ??= []).findIndex((x) => x.id === id);
          if (idx >= 0) mockStore[table][idx] = stored;
          else mockStore[table].push(stored);
        }
        return Promise.resolve({ error: null });
      },
      update: (payload: any) => ({
        eq: async (_col: string, val: unknown) => {
          if (table === "debts" && mockFailUpdateDebts) {
            return { error: new Error("update boom") };
          }
          const row = (mockStore[table] ?? []).find((r) => r.id === val);
          if (row) Object.assign(row, payload);
          if (table === "debts" && mockFailUpdateDebtsAfterApply) {
            return { error: new Error("update boom (applied)") };
          }
          return { error: null };
        },
      }),
      delete: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  },
}));

// Fake for the real Firestore transaction in
// src/integrations/firebase/adapter.ts. It mirrors the production
// semantics the page relies on: fresh reads inside the transaction,
// the payment doc re-read for same-attempt idempotency, atomic apply
// of record + balance, and a __version check + retry loop standing in
// for Firestore's contention retry (a second committer re-reads the
// debt instead of overwriting the first committer's total_paid).
vi.mock("@/integrations/firebase/adapter", async () => {
  const { debtPaymentId } = await vi.importActual<typeof import("@/lib/debts")>("@/lib/debts");
  return {
    // Reconcile read: the payment-doc lookup the page uses to tell a
    // committed attempt apart from one that never landed. It reads the
    // store SYNCHRONOUSLY (no await before the read), so it observes
    // the store as it is at the moment of the tap — the same race a
    // real getDoc runs against an in-flight transaction in another tab.
    getDebtPaymentByAttempt: async ({
      debtId,
      attemptKey,
    }: {
      userId: string;
      debtId: string;
      attemptKey: string;
    }) => {
      mockGetByAttemptCalls.push({ debtId, attemptKey });
      const paymentId = debtPaymentId(debtId, attemptKey);
      const found = mockStore.debt_payments.find((p) => p.id === paymentId);
      return found ? { amount: found.amount, created_at: found.created_at } : null;
    },
    recordDebtPaymentInTransaction: async ({
      debtId,
      attemptKey,
      amount,
    }: {
      userId: string;
      debtId: string;
      attemptKey: string;
      amount: number;
    }) => {
      mockTransactionCalls.push({ debtId, attemptKey, amount });
      const paymentId = debtPaymentId(debtId, attemptKey);
      for (let attempt = 0; attempt < 5; attempt++) {
        const debt = mockStore.debts.find((d) => d.id === debtId);
        const existing = mockStore.debt_payments.find((p) => p.id === paymentId);
        const readVersion = debt?.__version ?? 0;
        // Yield so a concurrent transaction can interleave its read
        // before this one commits — the same interleaving the server
        // resolves by retrying the loser.
        await Promise.resolve();
        if (mockFailTransactionNext) {
          mockFailTransactionNext = false;
          throw new Error("transaction boom (offline)");
        }
        if (mockFailUpdateDebts) {
          throw new Error("update boom");
        }
        if (!debt) throw new Error("Loan not found");
        if (existing) {
          // Same attempt already committed: the balance already
          // includes this payment — do not add it again.
          const totalPaid = debt.total_paid ?? 0;
          return {
            newTotalPaid: totalPaid,
            isFullyPaid: totalPaid >= (debt.principal ?? 0),
            alreadyRecorded: true,
          };
        }
        const principal = debt.principal ?? 0;
        const totalPaid = debt.total_paid ?? 0;
        if (!Number.isFinite(amount) || amount <= 0 || amount > principal - totalPaid) {
          throw new Error(
            `Payment is more than the remaining amount (${principal - totalPaid}).`,
          );
        }
        // Contention: the debt changed since this run read it — retry
        // with a fresh read, exactly as Firestore retries the
        // transaction function on ABORTED.
        if ((debt.__version ?? 0) !== readVersion) continue;
        const newTotalPaid = totalPaid + amount;
        const now = new Date().toISOString();
        mockStore.debt_payments.push({
          id: paymentId,
          user_id: "u1",
          debt_id: debtId,
          amount,
          created_at: now,
          updated_at: now,
        });
        debt.total_paid = newTotalPaid;
        debt.is_active = newTotalPaid < principal;
        debt.updated_at = now;
        debt.__version = (debt.__version ?? 0) + 1;
        if (mockFailUpdateDebtsAfterApply) {
          mockFailUpdateDebtsAfterApply = false;
          throw new Error("update boom (applied)");
        }
        return {
          newTotalPaid,
          isFullyPaid: newTotalPaid >= principal,
          alreadyRecorded: false,
        };
      }
      throw new Error("transaction contention: too many retries");
    },
  };
});

const mockUser = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  // Stable user identity: DebtsPage refetches in useEffect(…, [user]),
  // so a fresh object per render would re-run the fetch forever.
  useAuth: () => ({ user: mockUser, session: null, loading: false, signOut: async () => {} }),
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), toasts: [] }),
  toast: mockToast,
}));

vi.mock("@/components/RecurringExpenses", () => ({
  default: () => null,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>
          <DebtsPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

function debtFixture(): Row {
  return {
    id: "d1",
    name: "Test Loan",
    principal: 1200,
    interest_rate: 0,
    tenure_months: 12,
    emi_amount: 100,
    total_paid: 0,
    start_date: "2026-11-22",
    is_active: true,
    __version: 0,
  };
}

async function openPayForm() {
  fireEvent.click(await screen.findByRole("button", { name: "Record Payment" }));
  const amountInput = (await screen.findByLabelText("Payment amount")) as HTMLInputElement;
  expect(amountInput.value).toBe("100");
  return amountInput;
}

// Durably stored per-attempt entries for the fixture debt (u1/d1).
function storedAttemptKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith("ds:pay-attempt:u1:d1:")) keys.push(key);
  }
  return keys;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockStore.debts = [debtFixture()];
  mockStore.debt_payments = [];
  mockInsertCalls.length = 0;
  mockTransactionCalls.length = 0;
  mockGetByAttemptCalls.length = 0;
  mockGenId = 0;
  mockFailUpdateDebts = false;
  mockFailUpdateDebtsAfterApply = false;
  mockFailTransactionNext = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DebtsPage payment atomicity", () => {
  it("intermediate failure + retry: no orphaned record, then one payment record, total_paid 100", async () => {
    // REGRESSION (round 3): the payment insert succeeds but the balance
    // update fails. The failed attempt must leave NOTHING behind — no
    // orphaned payment doc with total_paid 0 — so the retry records the
    // payment exactly once. A two-write flow orphans the doc; a single
    // transaction rolls everything back.
    mockFailUpdateDebts = true;
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error" }),
      ),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
    );
    // Atomic rollback: the failed attempt wrote nothing.
    expect(mockStore.debt_payments).toHaveLength(0);
    expect(mockStore.debts[0].total_paid).toBe(0);

    // Retry with the write working: exactly one record, balance correct.
    mockFailUpdateDebts = false;
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
      ),
    );
    expect(mockStore.debt_payments).toHaveLength(1);
    expect(mockStore.debt_payments[0].amount).toBe(100);
    expect(mockStore.debts[0].total_paid).toBe(100);
  });

  it("reload/remount retry after an intermediate failure records exactly one payment", async () => {
    // REGRESSION (round 3, the reported finding): insert ok, balance
    // update fails, then the user navigates away and comes back (page
    // unmount + remount — the ref-only attempt key is gone) and retries.
    // The retry must reuse the DURABLY stored attempt key, so the same
    // payment doc is reused and no second 100 record appears.
    mockFailUpdateDebts = true;
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error" }),
      ),
    );
    // Pre-fix the failed attempt already orphaned one doc; post-fix the
    // transaction rolled back and left zero.
    expect(mockStore.debt_payments.length).toBeLessThanOrEqual(1);
    expect(mockStore.debts[0].total_paid).toBe(0);

    // The user leaves the page and returns: fresh component instance,
    // same localStorage (survives reload/remount).
    mockFailUpdateDebts = false;
    cleanup();
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
      ),
    );
    expect(mockStore.debt_payments).toHaveLength(1);
    expect(mockStore.debt_payments[0].amount).toBe(100);
    expect(mockStore.debts[0].total_paid).toBe(100);
  });

  it("uncertain result (payment applied, error returned) + reload retry: still one payment, total_paid 100", async () => {
    // REGRESSION (round 3): the payment + balance BOTH landed, but the
    // client was told the call failed (lost response / offline after
    // commit). The retry — after a reload, with a fresh read showing
    // total_paid already 100 — must find the previous payment inside the
    // transaction and NOT record or add it again.
    //
    // ROUND 4 CHANGE: the retry no longer claims "payment recorded".
    // It reconciles the pending attempt against the payment doc, finds
    // the payment already there, and says so plainly ("Already
    // recorded") — the old success toast is exactly what masked bug (a),
    // where a genuine second payment was silently dropped while the UI
    // still said it was recorded. One doc, total 100 either way.
    mockFailUpdateDebtsAfterApply = true;
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error" }),
      ),
    );
    // The write landed despite the error: one doc, balance already 100.
    expect(mockStore.debt_payments).toHaveLength(1);
    expect(mockStore.debts[0].total_paid).toBe(100);
    const firstPaymentId = mockStore.debt_payments[0].id;

    // The transient failure is over: the retry runs with writes working.
    mockFailUpdateDebtsAfterApply = false;

    // Reload: the page now reads total_paid 100 from the store.
    cleanup();
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Already recorded" }),
      ),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
    );
    expect(mockStore.debt_payments).toHaveLength(1);
    expect(mockStore.debt_payments[0].id).toBe(firstPaymentId);
    expect(mockStore.debt_payments[0].amount).toBe(100);
    expect(mockStore.debts[0].total_paid).toBe(100);
  });

  it("concurrent different payments both count: two records, total_paid 150 (no lost update)", async () => {
    // REGRESSION (round 3): two tabs/clients pay the same loan at the
    // same time — 100 here, 50 there. Each reads total_paid 0; both
    // must land, so the total is 150 — the second committer must
    // re-read the balance inside its transaction instead of overwriting
    // 100 with its own stale 0+50. (Two tabs paying the SAME amount at
    // the same instant share one attempt slot by design and are deduped
    // to one row — see src/lib/debts.ts — so this test uses two
    // different amounts, i.e. two genuinely different payments.)
    renderPage();
    renderPage();
    // Wait for BOTH instances to finish loading: findAllByRole resolves
    // as soon as one matches, which can catch only the first instance.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Record Payment" })).toHaveLength(2),
    );
    const recordButtons = screen.getAllByRole("button", { name: "Record Payment" });
    fireEvent.click(recordButtons[0]);
    fireEvent.click(recordButtons[1]);
    // Both instances default the amount to the 100 EMI; make the second
    // payment a different amount (50). Located by display value — the
    // two amount inputs share one DOM id across instances, so label
    // lookup cannot tell them apart.
    const amountInputs = screen.getAllByDisplayValue("100");
    expect(amountInputs).toHaveLength(2);
    fireEvent.change(amountInputs[1], { target: { value: "50" } });
    const payButtons = screen.getAllByRole("button", { name: "Pay" });
    expect(payButtons).toHaveLength(2);

    // Both taps in one batch, before either transaction commits.
    act(() => {
      payButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      payButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(mockStore.debts[0].total_paid).toBe(150));
    expect(mockStore.debt_payments).toHaveLength(2);
    expect(new Set(mockStore.debt_payments.map((p) => p.id)).size).toBe(2);
    expect(mockStore.debt_payments.map((p) => p.amount).sort((a, b) => a - b)).toEqual([50, 100]);
  });

  it("offline transaction failure shows an error only — never success — and leaves no payment record", async () => {
    // REGRESSION (round 3): the transaction cannot reach the server
    // (offline). The user must see ONLY the error: no success toast,
    // no payment doc, no balance move, and the pay form stays open so
    // the same attempt can be retried.
    mockFailTransactionNext = true;
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error" }),
      ),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("fully paid") }),
    );
    expect(mockStore.debt_payments).toHaveLength(0);
    expect(mockStore.debts[0].total_paid).toBe(0);
    // The form is still open for a retry of the same attempt.
    expect(screen.getByRole("button", { name: "Pay" })).toBeTruthy();
  });

  it("attempt-id save failure aborts visibly and never runs the transaction", async () => {
    // REGRESSION (round 3): the durable attempt id cannot be saved
    // (storage full / unavailable). The payment must NOT proceed with a
    // fresh in-memory id — a later retry could then double-record. It
    // fails visibly instead, with no transaction call and no record.
    renderPage();
    await openPayForm();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error" }),
      ),
    );
    expect(mockTransactionCalls).toHaveLength(0);
    expect(mockStore.debt_payments).toHaveLength(0);
    expect(mockStore.debts[0].total_paid).toBe(0);
  });

  it("rapid repeat taps on Pay record exactly one payment", async () => {
    renderPage();
    await openPayForm();
    const payBtn = screen.getByRole("button", { name: "Pay" });

    // Both taps dispatched in one act() batch, before any re-render:
    // the second must be a no-op.
    act(() => {
      payBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      payBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
      ),
    );
    expect(mockStore.debt_payments).toHaveLength(1);
    expect(mockStore.debts[0].total_paid).toBe(100);
  });

  it("a second genuine payment after success still creates its own record", async () => {
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
      ),
    );
    expect(mockStore.debt_payments).toHaveLength(1);
    expect(mockStore.debts[0].total_paid).toBe(100);

    // A new, separate payment of the same amount is a new record.
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mockStore.debts[0].total_paid).toBe(200));
    expect(mockStore.debt_payments).toHaveLength(2);
    expect(new Set(mockStore.debt_payments.map((p) => p.id)).size).toBe(2);
  });

  it("failed cleanup: a genuine second payment of the same amount still records a second doc, total 200", async () => {
    // REGRESSION (round 4, bug a): the first ₹100 records fine, but
    // localStorage.removeItem (cleanup) FAILS. The old single slot kept
    // the stale attempt id, so the next genuine ₹100 reused it and the
    // transaction no-op'd — while the UI still said "payment recorded".
    // Total stayed 100, expected 200. The fix reconciles the stale
    // attempt against the payment doc (it IS recorded — say so plainly,
    // never claim a fresh success) and only mints a fresh id once the
    // user confirms this is a NEW payment.
    renderPage();
    await openPayForm();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("removeItem boom");
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Pay" }));
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
        ),
      );
      expect(mockStore.debt_payments).toHaveLength(1);
      expect(mockStore.debts[0].total_paid).toBe(100);
      // The cleanup failure left the attempt durably stored.
      expect(storedAttemptKeys()).toHaveLength(1);
      const toastCallsAfterFirstPayment = mockToast.mock.calls.length;

      // Genuine second payment, same amount: the stale attempt is
      // reconciled — the doc exists — so this tap must NOT claim a
      // success it did not create.
      await openPayForm();
      fireEvent.click(screen.getByRole("button", { name: "Pay" }));
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Already recorded" }),
        ),
      );
      // No NEW "payment recorded" toast since the first payment: the
      // notice tap created nothing.
      const callsSinceFirstPayment = mockToast.mock.calls.slice(toastCallsAfterFirstPayment);
      expect(
        callsSinceFirstPayment.some(
          ([arg]) =>
            typeof (arg as { title?: unknown } | null)?.title === "string" &&
            ((arg as { title: string }).title.includes("payment recorded")),
        ),
      ).toBe(false);
      expect(mockStore.debt_payments).toHaveLength(1);
      expect(mockStore.debts[0].total_paid).toBe(100);
      expect(mockGetByAttemptCalls.length).toBeGreaterThanOrEqual(1);

      // The user confirms this is a NEW payment: fresh id, second doc.
      fireEvent.click(screen.getByRole("button", { name: "Pay" }));
      await waitFor(() => expect(mockStore.debts[0].total_paid).toBe(200));
      expect(mockStore.debt_payments).toHaveLength(2);
      expect(new Set(mockStore.debt_payments.map((p) => p.id)).size).toBe(2);
      expect(new Set(mockTransactionCalls.map((c) => c.attemptKey)).size).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("two pages, same debt + same amount, two genuine Pay actions: two records, total 200", async () => {
    // REGRESSION (round 4, bug b): two open web pages paying the same
    // debt the same amount shared ONE localStorage slot, so the second
    // tap reused the first tab's key — two success messages, one ₹100
    // entry. Each Pay intention now gets its own fresh attempt id, so
    // distinct attempts isolate and both count.
    renderPage();
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Record Payment" })).toHaveLength(2),
    );
    const recordButtons = screen.getAllByRole("button", { name: "Record Payment" });
    fireEvent.click(recordButtons[0]);
    fireEvent.click(recordButtons[1]);
    const payButtons = screen.getAllByRole("button", { name: "Pay" });
    expect(payButtons).toHaveLength(2);

    // Both taps in one batch, before either transaction commits.
    act(() => {
      payButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      payButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => expect(mockStore.debts[0].total_paid).toBe(200));
    expect(mockStore.debt_payments).toHaveLength(2);
    expect(new Set(mockStore.debt_payments.map((p) => p.id)).size).toBe(2);
    expect(mockStore.debt_payments.map((p) => p.amount).sort((a, b) => a - b)).toEqual([100, 100]);
    expect(new Set(mockTransactionCalls.map((c) => c.attemptKey)).size).toBe(2);
  });

  it("changed amount vs an unresolved old attempt: old stays pending, new records separately", async () => {
    // REGRESSION (round 4): a ₹100 attempt fails cleanly (unresolved),
    // then the user pays ₹150 instead. The old single slot OVERWROTE
    // the 100 attempt with the new one — losing the record that the 100
    // was ever attempted. The per-attempt registry keeps the old
    // attempt pending while the new amount gets its own fresh id.
    mockFailUpdateDebts = true;
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error" }),
      ),
    );
    expect(mockStore.debt_payments).toHaveLength(0);
    expect(mockStore.debts[0].total_paid).toBe(0);
    const pendingBefore = storedAttemptKeys();
    expect(pendingBefore).toHaveLength(1);
    expect(
      JSON.parse(window.localStorage.getItem(pendingBefore[0]) as string).amount,
    ).toBe(100);

    // Same form session, different amount: a new attempt, old untouched.
    mockFailUpdateDebts = false;
    const amountInput = screen.getByLabelText("Payment amount") as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining("payment recorded") }),
      ),
    );
    expect(mockStore.debt_payments).toHaveLength(1);
    expect(mockStore.debt_payments[0].amount).toBe(150);
    expect(mockStore.debts[0].total_paid).toBe(150);
    // The unresolved ₹100 attempt is still pending — not overwritten,
    // not cleared by the other amount's success.
    expect(window.localStorage.getItem(pendingBefore[0])).not.toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem(pendingBefore[0]) as string).amount,
    ).toBe(100);
  });
});
