import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import DailyReportPage from "./DailyReportPage";

afterEach(cleanup);

// The page reads four collections through the shared db client. The fake
// below answers per table; each test sets the response it needs. select()
// returns a promise (the settings query awaits it directly) with an .eq()
// that returns the same promise (the other queries await .eq(...)).
type Row = Record<string, unknown>;
const mockResponses: Record<string, { data: Row[] | null; error: Error | null }> = {};
let mockSelectCalls = 0;

vi.mock("@/lib/backend", () => ({
  db: {
    from: (table: string) => ({
      select: () => {
        mockSelectCalls += 1;
        const r = mockResponses[table] ?? { data: [], error: null };
        const p: any = r.error
          ? Promise.reject(r.error)
          : Promise.resolve({ data: r.data ?? [], error: null });
        p.eq = () => p;
        return p;
      },
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: null, loading: false, signOut: async () => {} }),
}));

const LOAD_ERROR = "Some data could not be loaded. Check your connection and try again.";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>
          <DailyReportPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const k of Object.keys(mockResponses)) delete mockResponses[k];
  mockResponses.transactions = { data: [], error: null };
  mockResponses.habits = { data: [], error: null };
  mockResponses.habit_logs = { data: [], error: null };
  mockResponses.routine_settings = { data: [], error: null };
  mockSelectCalls = 0;
});

describe("DailyReportPage load error vs genuinely empty", () => {
  it("shows an error and a retry action — not ₹0 totals — when a load fails", async () => {
    mockResponses.transactions = { data: null, error: new Error("boom") };
    renderPage();

    await screen.findByText(LOAD_ERROR);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // No totals at all in the error state (and no share of a wrong report).
    expect(screen.queryByText("Today's earnings")).toBeNull();
    expect(screen.getByRole("button", { name: /Share on WhatsApp/ })).toBeDisabled();
  });

  it("retries all four loads and shows the report once they succeed", async () => {
    mockResponses.transactions = { data: null, error: new Error("boom") };
    renderPage();
    await screen.findByText(LOAD_ERROR);
    const callsBeforeRetry = mockSelectCalls;

    mockResponses.transactions = { data: [], error: null };
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    const zeros = await screen.findAllByText("₹0");
    expect(zeros).toHaveLength(3); // income, expense, net
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(mockSelectCalls).toBeGreaterThan(callsBeforeRetry);
  });

  it("shows ₹0 totals with no error when the load succeeds and today is genuinely empty", async () => {
    renderPage();

    const zeros = await screen.findAllByText("₹0");
    expect(zeros).toHaveLength(3); // income, expense, net
    expect(screen.getByText("no entries yet")).toBeInTheDocument();
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: /Share on WhatsApp/ })).not.toBeDisabled();
  });

  it("still renders real totals when entries exist", async () => {
    mockResponses.transactions = {
      data: [{ type: "income", amount: 500, transaction_date: "2026-11-22", created_at: new Date().toISOString() }],
      error: null,
    };
    renderPage();

    // ₹500 twice: income and net (expense is ₹0).
    const fiveHundreds = await screen.findAllByText("₹500");
    expect(fiveHundreds).toHaveLength(2);
    expect(screen.queryByText(LOAD_ERROR)).toBeNull();
  });
});
