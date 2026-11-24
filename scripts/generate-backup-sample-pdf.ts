/**
 * Generates a readable sample "Export All Data" PDF using the app's own
 * buildBackupPdf() with fake sample data — the same code path the
 * DataBackupPage uses, so the preview shows exactly what a real export
 * looks like (including the new habits / habit-log / routine sections).
 *
 * No real user data: every row below is invented sample data.
 *
 * Usage: bun scripts/generate-backup-sample-pdf.ts [output-path]
 * Default output: ~/workspace/goals/driver-saathi-security-audit/files/driver-saathi-backup-sample-2026-11-22.pdf
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { buildBackupPdf } from "../src/lib/backupPdf";

type Row = Record<string, unknown>;

const SAMPLE: Record<string, Row[]> = {
  profiles: [
    {
      full_name: "Sample Driver",
      phone: "90000 00000",
      vehicle_number: "MH01AB1234",
      vehicle_type: "Car",
      license_number: "MH0120260000000",
    },
  ],
  transactions: [
    { transaction_date: "2026-11-21", type: "income", category: "Ola", description: "Airport drop", amount: 650 },
    { transaction_date: "2026-11-21", type: "income", category: "Uber", description: "City trips", amount: 820 },
    { transaction_date: "2026-11-21", type: "expense", category: "Fuel", description: "Petrol", amount: 500 },
    { transaction_date: "2026-11-20", type: "income", category: "Rapido", description: "Evening trips", amount: 940 },
    { transaction_date: "2026-11-20", type: "expense", category: "Food", description: "Lunch", amount: 180 },
    { transaction_date: "2026-11-19", type: "income", category: "Ola", description: "Morning trips", amount: 710 },
  ],
  debts: [
    { id: "d1", name: "Bike loan", principal: 50000, interest_rate: 12, tenure_months: 12, emi_amount: 4500, total_paid: 9000, is_active: true },
  ],
  debt_payments: [
    { debt_id: "d1", payment_date: "2026-11-01", amount: 4500 },
    { debt_id: "d1", payment_date: "2026-10-01", amount: 4500 },
  ],
  recurring_expenses: [
    { name: "Mobile recharge", category: "bills", due_day: 5, amount: 299, last_paid_date: "2026-11-05" },
    { name: "Car EMI", category: "emi", due_day: 10, amount: 8500, last_paid_date: "2026-11-10" },
  ],
  budgets: [
    { month: "2026-11", category: "Fuel", monthly_limit: 8000 },
    { month: "2026-11", category: "Food", monthly_limit: 6000 },
  ],
  goals: [
    { title: "New tyres", target_amount: 12000, saved_amount: 4500, deadline: "2026-12-31", is_completed: false },
  ],
  health_logs: [
    { log_date: "2026-11-21", sleep_hours: 7, water_glasses: 8, breaks_taken: 3, steps: 6400 },
    { log_date: "2026-11-20", sleep_hours: 6.5, water_glasses: 6, breaks_taken: 2, steps: 5200 },
  ],
  car_checks: [
    { check_date: "2026-11-15", check_type: "Oil level", odometer_reading: 45210, cost: 0, next_due_date: "2026-12-15", description: "OK" },
  ],
  car_documents: [
    { document_name: "Insurance", expiry_date: "2027-03-31" },
    { document_name: "PUC", expiry_date: "2026-12-20" },
  ],
  reminders: [
    { reminder_date: "2026-11-22", title: "EMI due", description: "Bike loan EMI", category: "emi", is_completed: false },
    { reminder_date: "2026-11-25", title: "Car service", description: "", category: "car", is_completed: false },
  ],
  notes: [{ title: "Good routes", content: "Airport runs pay best before 9am.", tags: ["tips"], created_at: "2026-11-18T10:00:00Z" }],
  emergency_contacts: [{ name: "Home", phone: "91111 11111", relationship: "Family", is_primary: true }],
  platform_affiliations: [
    { platform_name: "Ola", driver_id: "OLA12345", is_active: true },
    { platform_name: "Uber", driver_id: "UBER67890", is_active: true },
  ],
  habits: [
    { id: "h1", name: "Subah walk", sort_order: 1, active: true },
    { id: "h2", name: "Kaafi paani piya", sort_order: 2, active: true },
    { id: "h3", name: "Gaadi saaf aur check ki", sort_order: 3, active: true },
  ],
  habit_logs: [
    { id: "h1_2026-11-21", habit_id: "h1", date: "2026-11-21", done: true },
    { id: "h2_2026-11-21", habit_id: "h2", date: "2026-11-21", done: true },
    { id: "h3_2026-11-21", habit_id: "h3", date: "2026-11-21", done: false },
    { id: "h1_2026-11-20", habit_id: "h1", date: "2026-11-20", done: true },
    { id: "h2_2026-11-20", habit_id: "h2", date: "2026-11-20", done: false },
    { id: "h1_2026-11-19", habit_id: "h1", date: "2026-11-19", done: true },
    // Habit deleted since: still lists, labelled as deleted.
    { id: "gone_2026-11-21", habit_id: "gone", date: "2026-11-21", done: true },
  ],
  routine_settings: [
    { kind: "schedule", key: "wake", time: "07:00", enabled: true, message: "Utho, naya din nayi shuruaat." },
    { kind: "schedule", key: "depart", time: "07:30", enabled: true, message: "Gaadi nikalne ka time." },
    { kind: "schedule", key: "cp1", time: "10:30", enabled: true, message: "Checkpoint 1: hisaab lagao." },
    { kind: "schedule", key: "cp2", time: "13:30", enabled: true, message: "Checkpoint 2: hisaab lagao, phir khane ka break lo." },
    { kind: "schedule", key: "cp3", time: "17:00", enabled: true, message: "Checkpoint 3: dopahar ka hisaab." },
    { kind: "schedule", key: "cp4", time: "21:00", enabled: true, message: "Checkpoint 4: aakhri ghanta." },
    { kind: "schedule", key: "day_end", time: "22:00", enabled: true, message: "Din khatam, gaadi khadi." },
    { kind: "milestone", key: "cp1", min_amount: 500, max_amount: 700 },
    { kind: "milestone", key: "cp2", min_amount: 1000, max_amount: 1400 },
    { kind: "milestone", key: "cp3", min_amount: 1500, max_amount: 2100 },
    { kind: "milestone", key: "cp4", min_amount: 2200, max_amount: 3000 },
    { kind: "milestone", key: "day_end", min_amount: 2500, max_amount: 3500 },
    { kind: "shift", key: "mode", message: "day" },
  ],
};

const outPath = resolve(
  process.argv[2] ??
    `${homedir()}/workspace/goals/driver-saathi-security-audit/files/driver-saathi-backup-sample-2026-11-22.pdf`,
);

const doc = await buildBackupPdf(async (table) => SAMPLE[table] ?? [], {
  name: "Sample Driver",
  email: "sample@example.com",
});
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
console.log(`Wrote ${outPath} (${doc.getNumberOfPages()} pages)`);
