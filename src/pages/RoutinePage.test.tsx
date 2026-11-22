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
//
// The fake PERSISTS writes into mockSettingsRows, like the real store:
// update mutates the row with the .eq("id", …) id, and insert maps a
// payload `id` to the doc id (setDoc-with-id overwrites the same doc;
// no id gets a fresh adapter-generated id). A fake that dropped writes
// would let a "retry" test pass without anything actually being saved.
type Row = Record<string, any>;
const mockSettingsRows: Row[] = [];
const mockFailKeys = new Set<string>();
let mockSettingsPending = false;
// Refetch unavailable: the page keeps seeing NO rows even though the
// store holds them (stale/failed refetch after a save).
let mockSelectEmpty = false;
let mockGenId = 0;
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
          // Fresh object copies per read, like Firestore deserialization:
          // the page must never share object identity with the store, or
          // an in-place store mutation would silently rewrite the cached
          // query data too (and React Query's structural sharing would
          // then see "no change" and skip the effect that applies it).
          data: table === "routine_settings" ? (mockSelectEmpty ? [] : mockSettingsRows.map((r) => ({ ...r }))) : [],
          error: null,
        });
        p.eq = () => p;
        return p;
      },
      insert: (row: any) => {
        mockInsertCalls.push(row);
        if (table === "routine_settings") {
          const id = row.id ?? `gen-${++mockGenId}`;
          // Like the real adapter: inserts stamp created_at/updated_at.
          const stored = { ...row, id, created_at: row.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() };
          const idx = mockSettingsRows.findIndex((r) => r.id === id);
          if (idx >= 0) mockSettingsRows[idx] = stored;
          else mockSettingsRows.push(stored);
        }
        return Promise.resolve({ error: null });
      },
      update: (payload: any) => ({
        eq: async (_col: string, val: unknown) => {
          mockUpdateCalls.push(payload);
          if (mockFailKeys.has(`${payload.kind}:${payload.key}`)) {
            return { error: new Error("boom") };
          }
          if (table === "routine_settings") {
            const row = mockSettingsRows.find((r) => r.id === val);
            // Like the real adapter: a successful update stamps updated_at,
            // so the refetched row differs from the cached one and React
            // Query hands the page a NEW settings array.
            if (row) Object.assign(row, payload, { updated_at: new Date().toISOString() });
          }
          return { error: null };
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
  const utils = render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>
          <RoutinePage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...utils, client };
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
  mockSelectEmpty = false;
  mockGenId = 0;
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

  it("partial save: the failed edit (500 -> 600) survives the refetch, and retry writes 600", async () => {
    // REGRESSION (correction 1): edit cp1's target 500 -> 600, fail ONLY
    // that row, let another row save. The save invalidates the query, so
    // the refetch returns the OLD stored 500 — the page must NOT clobber
    // the intended 600 with it, and the next Save must write 600 while
    // reporting success (not silently write 500).
    mockFailKeys.add("milestone:cp1");
    const { client } = renderPage();
    await screen.findByRole("button", { name: "Save" });
    // Wait for the stored settings to load into the form first.
    await waitFor(() =>
      expect((screen.getByLabelText("Checkpoint 1 min") as HTMLInputElement).value).toBe("500"),
    );
    const updatedAtBefore = client.getQueryState(["routine_settings"])?.dataUpdatedAt ?? 0;
    const minInput = screen.getByLabelText("Checkpoint 1 min") as HTMLInputElement;
    fireEvent.change(minInput, { target: { value: "600" } });
    expect(minInput.value).toBe("600");
    await clickSave();

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Saved except 1 setting(s) - tap Save again to retry."),
    );
    // Wait until the invalidation refetch has actually landed (the query
    // cache timestamp moved) — otherwise the assertion below could pass
    // before the clobber happens.
    await waitFor(() =>
      expect(client.getQueryState(["routine_settings"])?.dataUpdatedAt ?? 0).toBeGreaterThan(updatedAtBefore),
    );
    // The failed edit is still on screen.
    expect((screen.getByLabelText("Checkpoint 1 min") as HTMLInputElement).value).toBe("600");
    // ...and the stored row really is still 500: the write failed.
    expect(mockSettingsRows.find((r) => r.kind === "milestone" && r.key === "cp1")?.min_amount).toBe(500);
    // The other row really did save.
    expect(mockSettingsRows.find((r) => r.kind === "milestone" && r.key === "cp2")?.min_amount).toBe(500);

    // Retry: the failed row now succeeds, and the retry writes 600 — not 500.
    mockFailKeys.clear();
    await clickSave();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    expect(mockSettingsRows.find((r) => r.kind === "milestone" && r.key === "cp1")?.min_amount).toBe(600);
    const cp1Updates = mockUpdateCalls.filter((c) => c.kind === "milestone" && c.key === "cp1");
    expect(cp1Updates[cp1Updates.length - 1].min_amount).toBe(600);
  });

  it("empty settings + refetch unavailable: two saves store exactly 13 rows, not 26", async () => {
    // REGRESSION (correction 2): no rows stored yet, and the refetch
    // never returns the rows the first save wrote (mockSelectEmpty), so
    // the page still sees an empty settings list on the second save. A
    // second blind insert would duplicate every row (26 stored rows for
    // 13 logical rows). The upsert must be idempotent: the ACTUAL stored
    // row count stays 13, with 13 distinct ids.
    mockSettingsRows.length = 0;
    mockSelectEmpty = true;
    renderPage();
    await clickSave();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    await clickSave();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));

    expect(mockSettingsRows).toHaveLength(13);
    expect(new Set(mockSettingsRows.map((r) => r.id)).size).toBe(13);
    expect(mockSettingsRows.filter((r) => r.kind === "schedule")).toHaveLength(7);
    expect(mockSettingsRows.filter((r) => r.kind === "milestone")).toHaveLength(5);
    expect(mockSettingsRows.filter((r) => r.kind === "shift")).toHaveLength(1);
  });

  it("legacy rows (random ids) are updated in place, never duplicated", async () => {
    // REGRESSION (correction 2, legacy handling): rows written before the
    // stable-id upsert carry adapter-generated ids. Saving over them must
    // update those docs, not insert a second doc per kind+key — and it
    // must not delete the legacy row (no data loss).
    renderPage();
    await clickSave();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    expect(mockSettingsRows).toHaveLength(13);
    expect(mockInsertCalls.filter((c) => c.kind === "schedule" || c.kind === "milestone" || c.kind === "shift")).toHaveLength(0);
    expect(mockSettingsRows.find((r) => r.kind === "schedule" && r.key === "cp1")?.id).toBe("s-cp1");
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

  it("legacy + stable milestone: the stable row (600) wins over the legacy row (500) listed first", async () => {
    // REGRESSION (fix 2): a legacy random-id milestone row (cp1 500)
    // and the stable-id row (milestone_cp1 600) exist together, legacy
    // first. The page's mapping dropped the row id, so the stable-row
    // preference could not work and the stale 500 showed. The stable
    // 600 must show — and the legacy row must NOT be deleted.
    mockSettingsRows.length = 0;
    mockSettingsRows.push(...settingsFixture());
    const legacyIdx = mockSettingsRows.findIndex((r) => r.kind === "milestone" && r.key === "cp1");
    mockSettingsRows.splice(legacyIdx, 1);
    mockSettingsRows.push(
      { id: "legacy-9", kind: "milestone", key: "cp1", min_amount: 500, max_amount: 700 },
      { id: "milestone_cp1", kind: "milestone", key: "cp1", min_amount: 600, max_amount: 800 },
    );
    renderPage();
    await waitFor(() =>
      expect((screen.getByLabelText("Checkpoint 1 min") as HTMLInputElement).value).toBe("600"),
    );
    expect((screen.getByLabelText("Checkpoint 1 max") as HTMLInputElement).value).toBe("800");
    // Saving keeps both rows: the stable row is updated in place and
    // the legacy row is left untouched, never deleted.
    await clickSave();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    expect(mockSettingsRows.filter((r) => r.kind === "milestone" && r.key === "cp1")).toHaveLength(2);
    expect(mockSettingsRows.find((r) => r.id === "milestone_cp1")?.min_amount).toBe(600);
    expect(mockSettingsRows.find((r) => r.id === "legacy-9")?.min_amount).toBe(500);
  });

  it("failed shift:mode retry: Night intent survives the refetch and the retry saves Night", async () => {
    // REGRESSION (fix 1): stored mode is Day. Switch to Night and save
    // with ONLY the shift:mode row failing while another row saves. The
    // save invalidates the query, so the refetch returns the OLD stored
    // Day — the page must NOT let that override the failed Night intent,
    // or Save-again would write Day while reporting success.
    mockFailKeys.add("shift:mode");
    const { client } = renderPage();
    await screen.findByRole("button", { name: "Save" });
    // Wait for the stored settings to load into the form first, or the
    // load effect would reset the Night toggle back to the stored Day.
    await waitFor(() =>
      expect((screen.getByLabelText("Checkpoint 1 min") as HTMLInputElement).value).toBe("500"),
    );
    const nightBtn = screen.getByRole("button", { name: "Night" });
    const dayBtn = screen.getByRole("button", { name: "Day" });
    const updatedAtBefore = client.getQueryState(["routine_settings"])?.dataUpdatedAt ?? 0;
    fireEvent.click(nightBtn);
    expect(nightBtn.className).toContain("bg-primary");
    await clickSave();

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Saved except 1 setting(s) - tap Save again to retry."),
    );
    // Wait until the invalidation refetch has actually landed.
    await waitFor(() =>
      expect(client.getQueryState(["routine_settings"])?.dataUpdatedAt ?? 0).toBeGreaterThan(updatedAtBefore),
    );
    // The failed Night intent is still selected — the refetched Day did
    // not clobber it — and the stored row really is still Day.
    expect(nightBtn.className).toContain("bg-primary");
    expect(dayBtn.className).not.toContain("bg-primary");
    expect(mockSettingsRows.find((r) => r.kind === "shift" && r.key === "mode")?.message).toBe("day");

    // Retry: the failed row now succeeds, and the retry writes Night.
    mockFailKeys.clear();
    await clickSave();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Routine saved"));
    expect(mockSettingsRows.find((r) => r.kind === "shift" && r.key === "mode")?.message).toBe("night");
    const modeUpdates = mockUpdateCalls.filter((c) => c.kind === "shift" && c.key === "mode");
    expect(modeUpdates[modeUpdates.length - 1].message).toBe("night");
  });
});
