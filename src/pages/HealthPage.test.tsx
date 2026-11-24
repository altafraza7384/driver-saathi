import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import { localToday } from "@/lib/budgets";
import HealthPage from "./HealthPage";

afterEach(cleanup);

// In-memory stand-in for health_logs. The today's-log select (eq on
// log_date) and the week select (gte/lte) are told apart by the chain
// used, so a test can fail just today's read — the reported live case.
type Row = Record<string, any>;
let mockTodayRows: Row[] = [];
let mockWeekRows: Row[] = [];
const mockUpsertCalls: Row[] = [];
let mockFailTodaySelect = false;

const mockUser = { id: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, session: null, loading: false, signOut: async () => {} }),
}));

vi.mock("@/lib/backend", () => ({
  db: {
    from: (table: string) => ({
      select: () => {
        let mode = "week";
        const chain: any = {};
        chain.eq = () => {
          mode = "today";
          return chain;
        };
        chain.gte = () => chain;
        chain.lte = () => chain;
        chain.order = () => chain;
        chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          const p =
            table === "health_logs" && mode === "today" && mockFailTodaySelect
              ? Promise.resolve({ data: null, error: new Error("permission denied") })
              : Promise.resolve({
                  data: mode === "today" ? [...mockTodayRows] : [...mockWeekRows],
                  error: null,
                });
          return p.then(resolve, reject);
        };
        return chain;
      },
      upsert: (payload: any) => {
        mockUpsertCalls.push(payload);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>
          <HealthPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

const today = localToday();
function logFixture(): Row {
  return {
    id: `hl_${today}`,
    log_date: today,
    sleep_hours: 7,
    water_glasses: 5,
    breaks_taken: 2,
    steps: 3000,
    updated_at: "2026-11-22T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTodayRows = [];
  mockWeekRows = [];
  mockUpsertCalls.length = 0;
  mockFailTodaySelect = false;
});

describe("HealthPage zero-overwrite guard", () => {
  it("read failure: Save stays disabled AND the handler refuses to upsert zeros", async () => {
    // REGRESSION (fix 5): the read failed, the fields were hidden, but
    // Save Today's Log stayed enabled. Saving upserted today's log
    // with sleep/water/breaks/steps ALL 0 and showed success —
    // overwriting any existing values with zeros.
    mockFailTodaySelect = true;
    renderPage();

    await screen.findByText("Some data could not be loaded. Check your connection and try again.");
    const saveBtn = screen.getByRole("button", { name: "Save Today's Log" });
    expect(saveBtn).toBeDisabled();
    // The quick-write buttons are not rendered while the read failed.
    expect(screen.queryByRole("button", { name: /Water/ })).toBeNull();

    // Clicking Save must not upsert a zero log. Pre-fix the button was
    // enabled here and this click upserted sleep/water/breaks/steps 0
    // with a success toast; post-fix the disabled button swallows the
    // click and nothing is written.
    // (The in-handler guard in upsertLog is a second layer for
    // programmatic/queued invocations that bypass the button state:
    // React never delivers a click to a button rendered disabled, so
    // jsdom cannot reach that layer through the DOM. It shares the
    // upsertLog path the two tests below exercise through Save.)
    fireEvent.click(saveBtn);
    // Let any mutation the click may have started settle, then assert
    // nothing was written: a plain expect right after the click could
    // pass before an async upsert lands.
    await new Promise((r) => setTimeout(r, 100));
    expect(mockUpsertCalls).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("retry after a failed read loads the existing values, and Save preserves them", async () => {
    mockFailTodaySelect = true;
    mockTodayRows = [logFixture()];
    mockWeekRows = [logFixture()];
    renderPage();

    await screen.findByText("Some data could not be loaded. Check your connection and try again.");
    expect(mockUpsertCalls).toHaveLength(0);

    mockFailTodaySelect = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    // The existing values load into the form — not zeros.
    await waitFor(() =>
      expect((screen.getByLabelText("Sleep (hrs)") as HTMLInputElement).value).toBe("7"),
    );
    expect((screen.getByLabelText("Water (glasses)") as HTMLInputElement).value).toBe("5");

    fireEvent.click(screen.getByRole("button", { name: "Save Today's Log" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(mockUpsertCalls).toHaveLength(1);
    expect(mockUpsertCalls[0]).toMatchObject({
      sleep_hours: 7,
      water_glasses: 5,
      breaks_taken: 2,
      steps: 3000,
    });
  });

  it("a successful load with existing values saves those values, not zeros", async () => {
    mockTodayRows = [logFixture()];
    mockWeekRows = [logFixture()];
    renderPage();

    await waitFor(() =>
      expect((screen.getByLabelText("Sleep (hrs)") as HTMLInputElement).value).toBe("7"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Today's Log" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(mockUpsertCalls).toHaveLength(1);
    expect(mockUpsertCalls[0]).toMatchObject({ sleep_hours: 7, water_glasses: 5 });
  });
});
