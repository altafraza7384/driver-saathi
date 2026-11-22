import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import RoutinePage from "./RoutinePage";

afterEach(cleanup);

// The page reads/writes one collection (routine_settings) and schedules
// local notifications. The db fake answers per call; failKeys lets a
// test fail individual rows to exercise the partial-save path.
type Row = Record<string, any>;
const mockSettingsRows: Row[] = [];
const mockFailKeys = new Set<string>();
let mockSettingsPending = false;
const mockUpdateCalls: Row[] = [];
const mockInsertCalls: Row[] = [];
const mockSchedule = vi.fn(async (..._args: unknown[]) => undefined);
const mockCancel = vi.fn(async (..._args: unknown[]) => undefined);
const mockRequestPermission = vi.fn(async (..._args: unknown[]) => true);

vi.mock("@/lib/backend", () => ({
  db: {
    from: (table: string) => ({
      select: () => {
        if (mockSettingsPending) {
          const p: any = new Promise(() => {});
          p.eq = () => p;
          return p;
        }
        const p: any = Promise.resolve({
          data: table === "routine_settings" ? [...mockSettingsRows] : [],
          error: null,
        });
        p.eq = () => p;
        return p;
      },
      insert: (row: any) => {
        mockInsertCalls.push(row);
        return Promise.resolve({ error: null });
      },
      update: (payload: any) => ({
        eq: async () => {
          mockUpdateCalls.push(payload);
          return mockFailKeys.has(`${payload.kind}:${payload.key}`)
            ? { error: new Error("boom") }
            : { error: null };
        },
      }),
    }),
  },
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    cancel: (...args: unknown[]) => mockCancel(...args),
    schedule: (...args: unknown[]) => mockSchedule(...args),
  },
}));

vi.mock("@/lib/native-push", () => ({
  requestLocalNotificationPermission: (...args: unknown[]) => mockRequestPermission(...args),
  foregroundNotificationId: () => 12345,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: null, loading: false, signOut: async () => {} }),
}));

function settingsFixture(cp1?: { min: number; max: number }): Row[] {
  const rows: Row[] = [];
  const times: Record<string, string> = {
    wake: "07:00", depart: "07:30", cp1: "10:30", cp2: "13:30", cp3: "17:00", cp4: "21:00", day_end: "22:00",
  };
  for (const [key, time] of Object.entries(times)) {
    rows.push({ id: `s-${key}`, kind: "schedule", key, time, enabled: true, message: `msg-${key}` });
  }
  for (const key of ["cp1", "cp2", "cp3", "cp4", "day_end"]) {
    const m = key === "cp1" && cp1 ? cp1 : { min: 500, max: 700 };
    rows.push({ id: `m-${key}`, kind: "milestone", key, min_amount: m.min, max_amount: m.max });
  }
  rows.push({ id: "shift-1", kind: "shift", key: "mode", message: "day" });
  return rows;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>
          <RoutinePage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

async function clickSave() {
  const saveBtn = await screen.findByRole("button", { name: "Save" });
  await waitFor(() => expect(saveBtn).not.toBeDisabled());
  fireEvent.click(saveBtn);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSettingsRows.length = 0;
  mockSettingsRows.push(...settingsFixture());
  mockFailKeys.clear();
  mockSettingsPending = false;
  mockUpdateCalls.length = 0;
  mockInsertCalls.length = 0;
  mockRequestPermission.mockResolvedValue(true);
  mockSchedule.mockResolvedValue(undefined);
  mockCancel.mockResolvedValue(undefined);
});

describe("RoutinePage save vs scheduling", () => {
  it("renders while settings are still loading — no render loop", async () => {
    mockSettingsPending = true;
    renderPage();
    // Regression test: `data: settings = []` handed the load effect a
    // FRESH array on every render while the query was pending, so the
    // effect (setState on [settings]) re-ran after every render and the
    // page spun in a render loop until the fetch resolved — on a slow
    // connection, indefinitely. With the stable EMPTY_SETTINGS default
    // the page renders once and waits. Without the fix this test never
    // reaches the assertion (the runner hangs).
    await screen.findByText("Roz ka Routine");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("save success + scheduling success: saved toast and scheduled status", async () => {
    renderPage();
    await clickSave();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    // All 7 enabled items scheduled with stable ids.
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const scheduledArg = mockSchedule.mock.calls[0]?.[0] as { notifications: unknown[] } | undefined;
    expect(scheduledArg).toBeDefined();
    expect(scheduledArg!.notifications).toHaveLength(7);
    await screen.findByText("7 daily reminders scheduled.");
  });

  it("scheduling failure does NOT turn the save into a failure", async () => {
    mockSchedule.mockRejectedValueOnce(new Error("no plugin"));
    renderPage();
    await clickSave();

    // The save itself still reports success — the scheduling failure
    // gets its own distinct state on the status line.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    expect(toast.error).not.toHaveBeenCalled();
    await screen.findByText("Saved, but reminders could not be scheduled on this device.");
  });

  it("permission denied: saved toast plus the no-permission status", async () => {
    mockRequestPermission.mockResolvedValueOnce(false);
    renderPage();
    await clickSave();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    expect(mockSchedule).not.toHaveBeenCalled();
    await screen.findByText("Notification permission not granted. Allow it in phone settings.");
  });

  it("one failed row: partial toast, no scheduling, and Save-again retries it", async () => {
    mockFailKeys.add("milestone:cp1");
    renderPage();
    await clickSave();

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Saved except 1 setting(s) - tap Save again to retry."),
    );
    expect(toast.success).not.toHaveBeenCalled();
    // Scheduling never ran: the scheduled reminders must match storage.
    expect(mockSchedule).not.toHaveBeenCalled();

    // Retry: the failed row now succeeds, the whole save reports saved.
    mockFailKeys.clear();
    await clickSave();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it("invalid target blocks the save before any write", async () => {
    mockSettingsRows.length = 0;
    mockSettingsRows.push(...settingsFixture({ min: 700, max: 500 }));
    renderPage();
    await clickSave();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Checkpoint target is invalid: amounts cannot be negative, and the maximum cannot be less than the minimum.",
      ),
    );
    expect(mockUpdateCalls).toHaveLength(0);
    expect(mockInsertCalls).toHaveLength(0);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
