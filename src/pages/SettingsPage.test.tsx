import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import SettingsPage from "./SettingsPage";

afterEach(cleanup);

// The night-shift toggle writes routine_settings rows, then reschedules
// reminders. The db fake persists writes into mockSettingsRows; the
// notifications fake answers per call.
type Row = Record<string, any>;
const mockSettingsRows: Row[] = [];
const mockProfile = {
  full_name: "Test Driver",
  phone: "9876543210",
  vehicle_type: "Sedan",
  vehicle_number: "MH 01 AB 1234",
  license_number: "DL123456",
};
let mockInsertFails = false;
const mockInsertCalls: Row[] = [];
const mockUpdateCalls: Row[] = [];
const mockSchedule = vi.fn(async (..._args: unknown[]) => undefined);
const mockCancel = vi.fn(async (..._args: unknown[]) => undefined);
const mockCheckPermissions = vi.fn(async (..._args: unknown[]) => ({ display: "granted" }));
let mockGenId = 0;

vi.mock("@/lib/backend", () => ({
  BACKEND: "firebase",
  db: {
    from: (table: string) => ({
      select: () => {
        const p: any = Promise.resolve({
          data: table === "routine_settings" ? mockSettingsRows.map((r) => ({ ...r })) : [],
          error: null,
        });
        p.eq = () => ({
          single: async () => ({ data: { ...mockProfile }, error: null }),
        });
        return p;
      },
      insert: (row: any) => {
        mockInsertCalls.push(row);
        if (mockInsertFails) return Promise.resolve({ error: new Error("boom") });
        if (table === "routine_settings") {
          const id = row.id ?? `gen-${++mockGenId}`;
          const stored = { ...row, id };
          const idx = mockSettingsRows.findIndex((r) => r.id === id);
          if (idx >= 0) mockSettingsRows[idx] = stored;
          else mockSettingsRows.push(stored);
        }
        return Promise.resolve({ error: null });
      },
      update: (payload: any) => ({
        eq: async (_col: string, val: unknown) => {
          mockUpdateCalls.push(payload);
          if (table === "routine_settings") {
            const row = mockSettingsRows.find((r) => r.id === val);
            if (row) Object.assign(row, payload);
          }
          return { error: null };
        },
      }),
    }),
  },
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: (...args: unknown[]) => mockCheckPermissions(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
    schedule: (...args: unknown[]) => mockSchedule(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "test@example.com" }, session: null, loading: false, signOut: async () => {} }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

async function toggleNightShift() {
  await screen.findByText("Night shift");
  const switches = screen.getAllByRole("switch");
  // Switch order on the page: dark mode, earnings nudge, night shift.
  fireEvent.click(switches[switches.length - 1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSettingsRows.length = 0;
  mockInsertFails = false;
  mockInsertCalls.length = 0;
  mockUpdateCalls.length = 0;
  mockGenId = 0;
  mockSchedule.mockResolvedValue(undefined);
  mockCancel.mockResolvedValue(undefined);
  mockCheckPermissions.mockResolvedValue({ display: "granted" });
});

describe("SettingsPage night-shift toggle: save vs scheduling", () => {
  it("writes succeed but scheduling fails: saved-success PLUS a scheduling warning, never only an error", async () => {
    // REGRESSION (correction 3): the toggle used to wrap the writes AND
    // the reschedule in one try/catch, so a scheduling failure (no plugin,
    // web, OS error) surfaced as a bare save error even though the shift
    // setting itself saved fine. Save and scheduling must be reported
    // separately, like RoutinePage already does.
    mockSchedule.mockRejectedValueOnce(new Error("no plugin"));
    renderPage();
    await toggleNightShift();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Shift setting saved"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith("Saved, but reminders could not be scheduled on this device.");
    // The setting really did save.
    expect(mockSettingsRows.find((r) => r.kind === "shift" && r.key === "mode")?.message).toBe("night");
  });

  it("write failure still shows only an error, no success and no scheduling", async () => {
    mockInsertFails = true;
    renderPage();
    await toggleNightShift();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("happy path: saved-success and scheduling runs, no warning", async () => {
    renderPage();
    await toggleNightShift();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Shift setting saved"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSettingsRows.find((r) => r.kind === "shift" && r.key === "mode")?.message).toBe("night");
  });
});
