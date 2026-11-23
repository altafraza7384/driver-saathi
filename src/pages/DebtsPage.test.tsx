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
let mockGenId = 0;
let mockFailUpdateDebts = false;
let mockFailInsertPayments = false;

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
        if (table === "debt_payments" && mockFailInsertPayments) {
          return Promise.resolve({ error: new Error("insert boom") });
        }
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
          return { error: null };
        },
      }),
      delete: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  },
}));

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
  };
}

async function openPayForm() {
  fireEvent.click(await screen.findByRole("button", { name: "Record Payment" }));
  const amountInput = (await screen.findByLabelText("Payment amount")) as HTMLInputElement;
  expect(amountInput.value).toBe("100");
  return amountInput;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.debts = [debtFixture()];
  mockStore.debt_payments = [];
  mockInsertCalls.length = 0;
  mockGenId = 0;
  mockFailUpdateDebts = false;
  mockFailInsertPayments = false;
});

describe("DebtsPage payment atomicity", () => {
  it("intermediate failure + retry: one payment record, total_paid 100 — not two records", async () => {
    // REGRESSION (fix 4): the payment insert succeeds but the balance
    // update fails. On retry the page inserted ANOTHER payment row, so
    // total_paid was 100 while TWO payment records of 100 existed.
    // The retry must reuse the same payment record (deterministic id).
    mockFailUpdateDebts = true;
    renderPage();
    await openPayForm();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error" }),
      ),
    );
    // The first insert landed; the balance did not move.
    expect(mockStore.debt_payments).toHaveLength(1);
    expect(mockStore.debts[0].total_paid).toBe(0);

    // Retry with the update working: no second record, balance correct.
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
});
