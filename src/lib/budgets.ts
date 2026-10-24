// Monthly envelope budgets (2026-10-24, user-approved).
//
// A budget is one per-user document in the `budgets` subcollection:
//   { category, monthly_limit, month: "yyyy-MM", user_id }
// Spent is NOT stored on the budget — it is always summed live from the
// user's expense transactions for that month, so budgets can never go
// stale when a transaction is added, edited or deleted.
//
// Rules that must stay true:
// - Budgets only WARN, never block a payment. A driver cannot be stopped
//   from buying CNG or paying EMI because an envelope ran out; the UI
//   shows the overrun in red and lets the user transfer between envelopes
//   by editing limits.
// - Category names are stored exactly as in EXPENSE_CATEGORIES (English),
//   so they match transaction categories byte-for-byte. Budget UI strings
//   themselves are translated via budget.* keys; category names are not.
// - A month's budgets are independent documents. The Budgets page offers
//   a one-tap "copy last month" instead of silently auto-copying, so a
//   user never gets limits they did not ask for in a new month.

export const BUDGET_CATEGORIES = [
  "Fuel",
  "Maintenance",
  "Food",
  "Tolls",
  "Insurance",
  "EMI",
  "Phone",
  "Subscription",
  "Other",
] as const;

export type Budget = {
  id: string;
  category: string;
  monthly_limit: number;
  month: string;
  user_id: string;
};

/** Local "yyyy-MM" for the current month (local time, not UTC). */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Local (device-timezone) date as yyyy-MM-dd. Never use
// new Date().toISOString().split("T")[0] for user-facing dates: UTC
// midnight is 05:30 IST, so 00:00–05:29 IST would show yesterday.
// (Audit 2026-10-24: Home/AddTransaction/Health/Debts all had this bug.)
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Previous month's "yyyy-MM" for a given month string. */
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Next month's "yyyy-MM" for a given month string. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** First/last local dates of a month, as "yyyy-MM-dd" for transaction queries. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` };
}

/** "Oct 2026" style label for a month string (date notation stays English). */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

/** Budget status: under 80% ok, 80–99% near the limit, 100%+ over. */
export function budgetStatus(spent: number, limit: number): "ok" | "near" | "over" {
  if (limit <= 0) return "ok";
  const pct = (spent / limit) * 100;
  if (pct >= 100) return "over";
  if (pct >= 80) return "near";
  return "ok";
}
