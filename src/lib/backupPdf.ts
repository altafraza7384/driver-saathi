// Human-readable "Download everything" PDF for the Data Backup page.
//
// The old export dumped raw Firestore fields (created_at, is_active,
// emi_amount, document ids, ISO timestamps) into auto-width tables, which
// a driver cannot read (QA 2026-11-01). Each section here declares the
// columns a person cares about, with labels and formatting.
//
// Labels are English with a short Roman-Hindi hint ("Len-den"). jsPDF's
// built-in fonts have no Devanagari glyphs and jsPDF does not shape Indic
// scripts, so Hindi script would print as boxes; Roman Hindi stays
// readable. For the same reason amounts use "Rs." — the built-in fonts
// have no ₹ glyph.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Fetch = (table: string) => Promise<Row[]>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-28" or an ISO timestamp -> "28 Oct 2026" (local date). */
export function fmtDate(value: unknown): string {
  if (!value) return "";
  const s = String(value);
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split("-").map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(s);
  }
  if (Number.isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** 1234567.5 -> "Rs. 12,34,567.50" (Indian grouping, paise only when present). */
export function fmtMoney(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  const s = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}Rs. ${s}`;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const yesNo = (v: unknown) => (v ? "Yes" : "No");
const cap = (v: unknown) => {
  const s = text(v);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

type Column = { label: string; value: (r: Row) => string; align?: "left" | "right" };
type Section = {
  table: string;
  title: string;
  columns: Column[];
  sort?: (a: Row, b: Row) => number;
  prepare?: (rows: Row[], ctx: Record<string, Row[]>) => Row[];
};

const byDesc = (key: string) => (a: Row, b: Row) => text(b[key]).localeCompare(text(a[key]));
const byAsc = (key: string) => (a: Row, b: Row) => text(a[key]).localeCompare(text(b[key]));

const SECTIONS: Section[] = [
  {
    table: "transactions",
    title: "Transactions (Len-den)",
    sort: (a, b) => byDesc("transaction_date")(a, b) || byDesc("created_at")(a, b),
    columns: [
      { label: "Date", value: (r) => fmtDate(r.transaction_date) },
      { label: "Type", value: (r) => (r.type === "income" ? "Income" : "Expense") },
      { label: "Category", value: (r) => text(r.category) + (r.platform ? ` (${r.platform})` : "") },
      { label: "Details", value: (r) => text(r.description) },
      { label: "Amount", value: (r) => fmtMoney(r.amount), align: "right" },
    ],
  },
  {
    table: "debts",
    title: "Loans & EMI (Karz)",
    sort: byDesc("created_at"),
    columns: [
      { label: "Loan", value: (r) => text(r.name) },
      { label: "Amount", value: (r) => fmtMoney(r.principal), align: "right" },
      { label: "Interest", value: (r) => `${num(r.interest_rate)}%` },
      { label: "Months", value: (r) => text(num(r.tenure_months) || "") },
      { label: "EMI / month", value: (r) => fmtMoney(Math.round(num(r.emi_amount))), align: "right" },
      { label: "Paid", value: (r) => fmtMoney(num(r.total_paid)), align: "right" },
      { label: "Remaining", value: (r) => fmtMoney(Math.max(0, num(r.principal) - num(r.total_paid))), align: "right" },
      { label: "Status", value: (r) => (r.is_active === false ? "Closed" : "Active") },
    ],
  },
  {
    table: "debt_payments",
    title: "Loan payments (Kist bhari)",
    sort: (a, b) => byDesc("payment_date")(a, b) || byDesc("created_at")(a, b),
    columns: [
      { label: "Date", value: (r) => fmtDate(r.payment_date || r.created_at) },
      { label: "Loan", value: (r) => text(r._loanName) },
      { label: "Amount", value: (r) => fmtMoney(r.amount), align: "right" },
    ],
    prepare: (rows, ctx) => {
      const names = new Map((ctx.debts ?? []).map((d) => [d.id, d.name]));
      return rows.map((r) => ({ ...r, _loanName: names.get(r.debt_id) ?? "(deleted loan)" }));
    },
  },
  {
    table: "recurring_expenses",
    title: "Monthly bills (Har mahine ke bill)",
    sort: (a, b) => num(a.due_day) - num(b.due_day),
    columns: [
      { label: "Bill", value: (r) => text(r.name) },
      { label: "Category", value: (r) => cap(r.category) },
      { label: "Due day", value: (r) => (r.due_day ? `Day ${r.due_day}` : "") },
      { label: "Amount", value: (r) => fmtMoney(r.amount), align: "right" },
      { label: "Last paid", value: (r) => fmtDate(r.last_paid_date) },
    ],
  },
  {
    table: "budgets",
    title: "Budgets",
    sort: (a, b) => byDesc("month")(a, b) || byAsc("category")(a, b),
    columns: [
      { label: "Month", value: (r) => fmtDate(`${r.month}-01`).slice(3) },
      { label: "Category", value: (r) => text(r.category) },
      { label: "Monthly limit", value: (r) => fmtMoney(r.monthly_limit), align: "right" },
    ],
  },
  {
    table: "goals",
    title: "Savings goals (Bachat)",
    sort: byDesc("created_at"),
    columns: [
      { label: "Goal", value: (r) => text(r.title) },
      { label: "Target", value: (r) => fmtMoney(r.target_amount), align: "right" },
      { label: "Saved", value: (r) => fmtMoney(num(r.saved_amount)), align: "right" },
      {
        label: "Progress",
        value: (r) => (num(r.target_amount) > 0 ? `${Math.min(100, Math.round((num(r.saved_amount) / num(r.target_amount)) * 100))}%` : ""),
      },
      { label: "Deadline", value: (r) => fmtDate(r.deadline) },
      { label: "Status", value: (r) => (r.is_completed ? "Completed" : "In progress") },
    ],
  },
  {
    table: "health_logs",
    title: "Health log (Sehat)",
    sort: byDesc("log_date"),
    prepare: (rows) => {
      // One row per day (older data can hold duplicates for a day).
      const byDay = new Map<string, Row>();
      for (const r of rows) {
        const prev = byDay.get(r.log_date);
        if (!prev || r.id === `hl_${r.log_date}` || (prev.id !== `hl_${r.log_date}` && text(r.updated_at) > text(prev.updated_at))) {
          byDay.set(r.log_date, r);
        }
      }
      return [...byDay.values()];
    },
    columns: [
      { label: "Date", value: (r) => fmtDate(r.log_date) },
      { label: "Sleep (hrs)", value: (r) => text(num(r.sleep_hours)) },
      { label: "Water (glasses)", value: (r) => text(num(r.water_glasses)) },
      { label: "Breaks", value: (r) => text(num(r.breaks_taken)) },
      { label: "Steps", value: (r) => num(r.steps).toLocaleString("en-IN") },
    ],
  },
  {
    table: "car_checks",
    title: "Car checks (Gaadi jaanch)",
    sort: byDesc("check_date"),
    columns: [
      { label: "Date", value: (r) => fmtDate(r.check_date) },
      { label: "Check", value: (r) => text(r.check_type) },
      { label: "Odometer (km)", value: (r) => (r.odometer_reading ? num(r.odometer_reading).toLocaleString("en-IN") : "") },
      { label: "Cost", value: (r) => (r.cost ? fmtMoney(r.cost) : ""), align: "right" },
      { label: "Next due", value: (r) => fmtDate(r.next_due_date) },
      { label: "Notes", value: (r) => text(r.description) },
    ],
  },
  {
    table: "car_documents",
    title: "Car documents (Gaadi ke kagaz)",
    sort: byAsc("expiry_date"),
    columns: [
      { label: "Document", value: (r) => text(r.document_name) },
      { label: "Expires on", value: (r) => fmtDate(r.expiry_date) },
    ],
  },
  {
    table: "reminders",
    title: "Reminders (Yaad dilana)",
    sort: byAsc("reminder_date"),
    columns: [
      { label: "Date", value: (r) => fmtDate(r.reminder_date) },
      { label: "Reminder", value: (r) => text(r.title) + (r.description ? ` - ${r.description}` : "") },
      { label: "Category", value: (r) => cap(r.category) },
      { label: "Status", value: (r) => (r.is_completed ? "Done" : "Pending") },
    ],
  },
  {
    table: "notes",
    title: "Notes",
    sort: byDesc("created_at"),
    columns: [
      { label: "Date", value: (r) => fmtDate(r.created_at) },
      { label: "Title", value: (r) => text(r.title) },
      { label: "Note", value: (r) => text(r.content) },
      { label: "Tags", value: (r) => (Array.isArray(r.tags) ? r.tags.join(", ") : text(r.tags)) },
    ],
  },
  {
    table: "emergency_contacts",
    title: "Emergency contacts",
    columns: [
      { label: "Name", value: (r) => text(r.name) },
      { label: "Phone", value: (r) => text(r.phone) },
      { label: "Relation", value: (r) => text(r.relationship) },
      { label: "Primary", value: (r) => yesNo(r.is_primary) },
    ],
  },
  {
    table: "platform_affiliations",
    title: "Platforms",
    columns: [
      { label: "Platform", value: (r) => text(r.platform_name) },
      { label: "Driver ID", value: (r) => text(r.driver_id) },
      { label: "Active", value: (r) => (r.is_active === false ? "No" : "Yes") },
    ],
  },
];

/** Builds the PDF and returns it (the caller decides how to save/share). */
export async function buildBackupPdf(fetchTable: Fetch, opts: { name?: string | null; email?: string | null }): Promise<jsPDF> {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Driver Saathi - My Data", 14, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const now = new Date();
  const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  doc.text(`Downloaded on ${fmtDate(now.toISOString())}, ${time}`, 14, y);
  y += 5;
  const who = [opts.name, opts.email].filter(Boolean).join(" - ");
  if (who) { doc.text(who, 14, y); y += 5; }

  // Profile as a small key/value table.
  const profileRows = await fetchTable("profiles");
  const p = profileRows[0] ?? {};
  const profilePairs: [string, string][] = [
    ["Name", text(p.full_name)],
    ["Phone", text(p.phone)],
    ["Vehicle number", text(p.vehicle_number)],
    ["Vehicle type", text(p.vehicle_type)],
    ["Licence number", text(p.license_number)],
  ].filter(([, v]) => v) as [string, string][];

  const ctx: Record<string, Row[]> = {};
  const data: Record<string, Row[]> = {};
  for (const s of SECTIONS) {
    data[s.table] = await fetchTable(s.table);
    ctx[s.table] = data[s.table];
  }

  // Summary of money first: what a driver usually wants to see.
  const tx = data.transactions ?? [];
  const income = tx.filter((t) => t.type === "income").reduce((s, t) => s + num(t.amount), 0);
  const expense = tx.filter((t) => t.type !== "income").reduce((s, t) => s + num(t.amount), 0);
  const loansLeft = (data.debts ?? []).filter((d) => d.is_active !== false).reduce((s, d) => s + Math.max(0, num(d.principal) - num(d.total_paid)), 0);
  y += 3;
  autoTable(doc, {
    startY: y,
    head: [["Summary (Kul hisaab)", ""]],
    body: [
      ["Total income", fmtMoney(income)],
      ["Total expenses", fmtMoney(expense)],
      ["Net (income - expenses)", fmtMoney(income - expense)],
      ["Loan amount still to pay", fmtMoney(loansLeft)],
      ...profilePairs,
    ],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: { 0: { cellWidth: 70, fontStyle: "bold" }, 1: { halign: "right" } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  for (const s of SECTIONS) {
    let rows = data[s.table] ?? [];
    if (!rows.length) continue;
    if (s.prepare) rows = s.prepare(rows, ctx);
    if (s.sort) rows = [...rows].sort(s.sort);
    if (y > 255) { doc.addPage(); y = 18; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`${s.title}  -  ${rows.length}`, 14, y);
    y += 3;
    const columnStyles: Record<number, { halign: "right" }> = {};
    s.columns.forEach((c, i) => { if (c.align === "right") columnStyles[i] = { halign: "right" }; });
    autoTable(doc, {
      startY: y,
      head: [s.columns.map((c) => c.label)],
      body: rows.map((r) => s.columns.map((c) => c.value(r))),
      theme: "striped",
      styles: { fontSize: 9, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [37, 99, 235], fontStyle: "bold" },
      columnStyles,
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Page numbers.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Driver Saathi  |  Page ${i} of ${pages}`, pageW / 2, doc.internal.pageSize.getHeight() - 8, { align: "center" });
  }
  return doc;
}
