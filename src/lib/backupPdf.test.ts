import { describe, expect, it } from "vitest";
import { buildBackupPdf } from "@/lib/backupPdf";

/** jsPDF writes text as literal strings in the (uncompressed) content
 *  streams, so decoding the raw output as latin1 lets tests assert on
 *  the visible text without a PDF parser. Parentheses are backslash-
 *  escaped in PDF literal strings, so unescape them first. */
function pdfText(doc: { output: (type: "arraybuffer") => ArrayBuffer }): string {
  const raw = new TextDecoder("latin1").decode(doc.output("arraybuffer"));
  return raw.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
}

type Row = Record<string, unknown>;

const SAMPLE: Record<string, Row[]> = {
  profiles: [{ full_name: "Sample Driver", phone: "9000000000", vehicle_number: "MH01AB1234" }],
  transactions: [
    { transaction_date: "2026-11-21", type: "income", category: "Ola", description: "Airport drop", amount: 650 },
    { transaction_date: "2026-11-21", type: "expense", category: "Fuel", description: "Petrol", amount: 300 },
  ],
  debts: [{ name: "Bike loan", principal: 50000, interest_rate: 12, tenure_months: 12, emi_amount: 4500, total_paid: 9000, is_active: true }],
  debt_payments: [{ debt_id: "d1", payment_date: "2026-11-01", amount: 4500 }],
  recurring_expenses: [],
  budgets: [],
  goals: [],
  health_logs: [],
  car_checks: [],
  car_documents: [],
  reminders: [{ reminder_date: "2026-11-22", title: "EMI due", description: "", category: "emi", is_completed: false }],
  notes: [],
  emergency_contacts: [],
  platform_affiliations: [],
  habits: [
    { id: "h1", name: "Subah walk", sort_order: 1, active: true },
    { id: "h2", name: "Paani piya", sort_order: 2, active: true },
    { id: "h3", name: "Band habit", sort_order: 3, active: false },
  ],
  habit_logs: [
    { id: "h1_2026-11-21", habit_id: "h1", date: "2026-11-21", done: true },
    { id: "h2_2026-11-21", habit_id: "h2", date: "2026-11-21", done: false },
    { id: "h1_2026-11-20", habit_id: "h1", date: "2026-11-20", done: true },
    // Habit deleted since: the log must still list, labelled as deleted.
    { id: "gone_2026-11-21", habit_id: "gone", date: "2026-11-21", done: true },
  ],
  routine_settings: [
    { kind: "schedule", key: "wake", time: "07:00", enabled: true, message: "Utho, naya din." },
    { kind: "schedule", key: "cp3", time: "02:00", enabled: false, message: "Checkpoint 3." },
    { kind: "milestone", key: "cp1", min_amount: 500, max_amount: 700 },
    { kind: "milestone", key: "cp2", min_amount: 0, max_amount: 0 },
    { kind: "shift", key: "mode", message: "night" },
  ],
};

const fetchTable = async (table: string): Promise<Row[]> => SAMPLE[table] ?? [];

describe("buildBackupPdf routine sections", () => {
  it("includes habits with names and active state", async () => {
    const text = pdfText(await buildBackupPdf(fetchTable, { name: "Sample Driver", email: "sample@example.com" }));
    expect(text).toContain("Habits");
    expect(text).toContain("Subah walk");
    expect(text).toContain("Paani piya");
    expect(text).toContain("Band habit");
  });

  it("includes the habit log with habit names, dates and done state", async () => {
    const text = pdfText(await buildBackupPdf(fetchTable, { name: null, email: null }));
    expect(text).toContain("Habit log");
    expect(text).toContain("21 Nov 2026");
    // A log whose habit was deleted still lists, labelled as deleted.
    expect(text).toContain("(deleted habit)");
  });

  it("includes routine settings as readable Setting/Value rows", async () => {
    const text = pdfText(await buildBackupPdf(fetchTable, { name: null, email: null }));
    expect(text).toContain("Routine settings");
    expect(text).toContain("Reminder - Wake reminder");
    expect(text).toContain("07:00");
    // Disabled schedule row is marked off.
    expect(text).toContain("02:00 (off)");
    // Set target shows the range; unset target says Not set.
    expect(text).toContain("Target - Checkpoint 1");
    expect(text).toContain("Rs. 500 - Rs. 700");
    expect(text).toContain("Target - Checkpoint 2");
    expect(text).toContain("Not set");
    // Shift mode row.
    expect(text).toContain("Night");
  });

  it("keeps all pre-existing sections", async () => {
    const text = pdfText(await buildBackupPdf(fetchTable, { name: null, email: null }));
    expect(text).toContain("Transactions");
    expect(text).toContain("Loans & EMI");
    expect(text).toContain("Reminders");
    expect(text).toContain("Summary");
    expect(text).toContain("Airport drop");
  });

  it("omits the routine sections when there is no routine data", async () => {
    const emptyFetch = async (table: string): Promise<Row[]> =>
      table === "habits" || table === "habit_logs" || table === "routine_settings" ? [] : SAMPLE[table] ?? [];
    const text = pdfText(await buildBackupPdf(emptyFetch, { name: null, email: null }));
    expect(text).not.toContain("Habits");
    expect(text).not.toContain("Habit log");
    expect(text).not.toContain("Routine settings");
    // The rest of the export still builds.
    expect(text).toContain("Transactions");
  });
});
