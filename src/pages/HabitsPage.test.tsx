import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import HabitsPage from "./HabitsPage";

afterEach(cleanup);

// In-memory stand-in for the habits / habit_logs collections. A row
// becomes visible only once its insert promise resolves (like the server
// applying the write), so a refetch after a save sees the saved row and a
// refetch mid-save does not.
type Row = Record<string, any>;
const mockStore: Record<string, Row[]> = { habits: [], habit_logs: [] };
const mockInsertCalls: Array<{ table: string; row: unknown }> = [];
// Tables whose select() currently fails (permission-denied reads): the
// page must show an error/retry state, never the genuine-empty state.
const mockFailSelect = new Set<string>();
// Queue of held insert promises: each insert() takes the next one, so a
// test can hold individual saves pending and resolve them out of order.
const mockInsertQueue: Array<{ promise: Promise<any>; resolve: (v: any) => void }> = [];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

vi.mock("@/lib/backend", () => ({
  db: {
    from: (table: string) => ({
      select: () => {
        const p: any = Promise.resolve(
          mockFailSelect.has(table)
            ? { data: null, error: new Error("permission denied") }
            : { data: [...(mockStore[table] ?? [])], error: null },
        );
        p.eq = () => p;
        p.gte = () => p;
        p.order = () => p;
        return p;
      },
      insert: (row: any) => {
        mockInsertCalls.push({ table, row });
        const rows = Array.isArray(row) ? row : [row];
        const next = mockInsertQueue.shift();
        if (next) {
          next.promise.then(() => {
            for (const r of rows) (mockStore[table] ??= []).push(r);
          });
          return next.promise;
        }
        for (const r of rows) (mockStore[table] ??= []).push(r);
        return Promise.resolve({ error: null });
      },
      delete: () => {
        const p: any = Promise.resolve({ error: null });
        p.eq = (col: string, val: unknown) => {
          if (col === "id") {
            const rows = mockStore.habit_logs;
            const i = rows.findIndex((r) => r.id === val);
            if (i >= 0) rows.splice(i, 1);
          }
          return p;
        };
        return p;
      },
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: null, loading: false, signOut: async () => {} }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter>
          <HabitsPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockStore.habits = [
    { id: "h1", name: "Habit A", sort_order: 1, active: true },
    { id: "h2", name: "Habit B", sort_order: 2, active: true },
  ];
  mockStore.habit_logs = [];
  mockInsertCalls.length = 0;
  mockInsertQueue.length = 0;
  mockFailSelect.clear();
});

describe("HabitsPage per-habit in-flight guard", () => {
  it("same-tick rapid clicks on one habit fire exactly one save and end checked once", async () => {
    const d = deferred<{ error: null }>();
    mockInsertQueue.push(d);
    renderPage();
    const btnA = await screen.findByRole("button", { name: /Habit A/ });
    expect(btnA).toHaveAttribute("aria-pressed", "false");

    // Both clicks dispatched in one act() batch, before any re-render:
    // the second must be a no-op (the ref sees h1 already in flight).
    // The mutation function itself runs asynchronously, so wait for the
    // single insert to land.
    act(() => {
      btnA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      btnA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() =>
      expect(mockInsertCalls.filter((c) => c.table === "habit_logs")).toHaveLength(1),
    );

    // The save completes; the refetch sees the one saved row.
    d.resolve({ error: null });
    await waitFor(() => expect(btnA).toHaveAttribute("aria-pressed", "true"));
    expect(mockStore.habit_logs.filter((l) => l.habit_id === "h1" && l.done)).toHaveLength(1);
    expect(btnA).not.toBeDisabled();
  });

  it("shows per-row saving feedback only on the habit whose save is in flight", async () => {
    const d = deferred<{ error: null }>();
    mockInsertQueue.push(d);
    renderPage();
    const btnA = await screen.findByRole("button", { name: /Habit A/ });
    const btnB = await screen.findByRole("button", { name: /Habit B/ });

    fireEvent.click(btnA); // A's save starts, held pending
    await waitFor(() => expect(btnA).toBeDisabled());
    // A shows the saving state; B (not saving) shows none.
    expect(screen.getAllByText("Saving...")).toHaveLength(1);
    expect(btnA).toHaveAttribute("aria-busy", "true");
    expect(btnB).toHaveAttribute("aria-busy", "false");
    expect(btnB).not.toBeDisabled();

    d.resolve({ error: null });
    await waitFor(() => expect(btnA).not.toBeDisabled());
    expect(screen.queryByText("Saving...")).toBeNull();
  });

  it("two different habits' overlapping saves both complete with no cross-interference", async () => {
    const dA = deferred<{ error: null }>();
    const dB = deferred<{ error: null }>();
    mockInsertQueue.push(dA, dB);
    renderPage();
    const btnA = await screen.findByRole("button", { name: /Habit A/ });
    const btnB = await screen.findByRole("button", { name: /Habit B/ });

    fireEvent.click(btnA); // A's save starts, held pending
    expect(btnA).toBeDisabled();
    expect(btnB).not.toBeDisabled(); // B is unaffected by A's save
    fireEvent.click(btnB); // B's save starts, held pending
    expect(btnB).toBeDisabled();
    expect(btnA).toBeDisabled(); // A is still in flight — B did NOT re-enable it
    // The mutation functions run asynchronously, so wait for both inserts.
    await waitFor(() =>
      expect(mockInsertCalls.filter((c) => c.table === "habit_logs")).toHaveLength(2),
    );

    // Resolve B first, then A (out of order): each settle frees only its own habit.
    dB.resolve({ error: null });
    await waitFor(() => expect(btnB).not.toBeDisabled());
    expect(btnA).toBeDisabled(); // A still saving
    dA.resolve({ error: null });
    await waitFor(() => expect(btnA).not.toBeDisabled());

    await waitFor(() => expect(btnA).toHaveAttribute("aria-pressed", "true"));
    expect(btnB).toHaveAttribute("aria-pressed", "true");
    expect(mockStore.habit_logs.filter((l) => l.done)).toHaveLength(2);
  });
});

describe("HabitsPage read failure (permission-denied reads)", () => {
  it("habits read fails: error + Retry, never the genuine-empty state, and no seed is offered", async () => {
    // REGRESSION (fix 3): on the live rules the habits read is
    // permission-denied, so the query errors and habits defaults to [].
    // The page must NOT show "No habits yet." with a seed button — that
    // is the genuine-empty state, and seeding while the read is denied
    // would write into a collection the app cannot even read.
    mockFailSelect.add("habits");
    renderPage();

    await screen.findByText("Some data could not be loaded. Check your connection and try again.");
    expect(screen.queryByText("No habits yet.")).toBeNull();
    expect(screen.queryByText("Start with my 3 default habits")).toBeNull();
    expect(mockInsertCalls.filter((c) => c.table === "habits")).toHaveLength(0);
    // The Add button is disabled while a read has failed.
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    // Retry with the read now working loads the real habits.
    mockFailSelect.clear();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: /Habit A/ });
    expect(screen.queryByText("No habits yet.")).toBeNull();
  });

  it("habit_logs read fails: error state even though the habits themselves loaded", async () => {
    // The habits list is there, but without logs the page cannot know
    // what is done — showing the list with every habit unchecked would
    // be a lie, and toggling would write against an unknown state.
    mockFailSelect.add("habit_logs");
    renderPage();

    await screen.findByText("Some data could not be loaded. Check your connection and try again.");
    expect(screen.queryByRole("button", { name: /Habit A/ })).toBeNull();
    expect(screen.queryByText("Start with my 3 default habits")).toBeNull();
    expect(mockInsertCalls).toHaveLength(0);

    mockFailSelect.clear();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: /Habit A/ });
  });

  it("genuine empty (reads succeed, no habits) still shows the empty state with seed", async () => {
    mockStore.habits = [];
    renderPage();

    await screen.findByText("No habits yet.");
    expect(screen.getByRole("button", { name: "Start with my 3 default habits" })).not.toBeDisabled();
    expect(screen.queryByText("Some data could not be loaded. Check your connection and try again.")).toBeNull();
  });
});
