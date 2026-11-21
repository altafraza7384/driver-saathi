import { formatINR } from "@/lib/currency";

/**
 * "Roz ka Routine" — daily discipline schedule, earning checkpoints, habits
 * and the daily report. All timing/id logic lives here as pure functions so
 * it is testable without a device; pages only render and persist.
 *
 * Reminder philosophy (product decision, 2026-11-21): these are REMINDER
 * notifications, not exact alarms. We never request SCHEDULE_EXACT_ALARM or
 * full-screen intents, never promise exact timing, and the wake reminder is
 * labelled as a companion to the phone's clock alarm. Battery optimisation
 * may delay them a few minutes, which is fine for checkpoints.
 */

export interface ScheduleItem {
  key: string;
  time: string; // "HH:MM" 24h local
  enabled: boolean;
  message: string;
}

export interface Milestone {
  key: string; // matches a schedule key (cp1..cp4, day_end)
  min: number;
  max: number;
}

export const SCHEDULE_KEYS = ["wake", "depart", "cp1", "cp2", "cp3", "cp4", "day_end"] as const;

export const DEFAULT_SCHEDULE: ScheduleItem[] = [
  { key: "wake", time: "07:00", enabled: true, message: "Utho, naya din nayi shuruaat. Ek slot miss ho jaye toh agle slot se dobara shuru." },
  { key: "depart", time: "07:30", enabled: true, message: "Gaadi nikalne ka time. Aaj ke checkpoints line se follow karo." },
  { key: "cp1", time: "10:30", enabled: true, message: "Checkpoint 1: ab tak ki app kamai ka hisaab lagao." },
  { key: "cp2", time: "13:30", enabled: true, message: "Checkpoint 2: hisaab lagao, phir khane ka break lo." },
  { key: "cp3", time: "17:00", enabled: true, message: "Checkpoint 3: dopahar ka hisaab. Shaam ka slot shuru." },
  { key: "cp4", time: "21:00", enabled: true, message: "Checkpoint 4: aakhri ghanta. Ab thakaan ke saath chase mat karo." },
  { key: "day_end", time: "22:00", enabled: true, message: "Raat 10 baje, gaadi khadi. Thakaan ke saath target chase mat karo, kal phir se." },
];

/** Planning targets start UNSET (0–0) on purpose: the repo is public, so
 *  no personal earning numbers are hardcoded. Each driver enters their own
 *  range in Routine settings; the Home card and report stay quiet until
 *  then. Values are trial planning targets, never a forecast or guarantee. */
export const DEFAULT_MILESTONES: Milestone[] = [
  { key: "cp1", min: 0, max: 0 },
  { key: "cp2", min: 0, max: 0 },
  { key: "cp3", min: 0, max: 0 },
  { key: "cp4", min: 0, max: 0 },
  { key: "day_end", min: 0, max: 0 },
];

/** True when a milestone carries no target yet. */
export function milestoneIsUnset(m: Milestone): boolean {
  return m.min === 0 && m.max === 0;
}

export function parseTime(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Minutes since local midnight, for comparisons. */
export function minutesOf(value: string): number {
  const p = parseTime(value);
  return p ? p.hour * 60 + p.minute : 0;
}

/**
 * Stable notification id per schedule key. Date.now()-based ids change on
 * every reschedule, leaving stale copies of the old reminder behind; a
 * deterministic id lets schedule() replace the same reminder. Android wants
 * a 32-bit Java int.
 */
export function routineNotificationId(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2_000_000_000) + 1;
}

/** Merge stored rows over defaults; unknown stored keys are ignored. */
export function mergeSchedule(
  stored: { key: string; time: string; enabled: boolean; message: string }[],
  defaults: ScheduleItem[] = DEFAULT_SCHEDULE,
): ScheduleItem[] {
  return defaults.map((d) => {
    const row = stored.find((s) => s.key === d.key);
    return row
      ? { key: d.key, time: row.time || d.time, enabled: row.enabled, message: row.message || d.message }
      : d;
  });
}

export function mergeMilestones(
  stored: { key: string; min: number; max: number }[],
  defaults: Milestone[] = DEFAULT_MILESTONES,
): Milestone[] {
  return defaults.map((d) => {
    const row = stored.find((s) => s.key === d.key);
    return row ? { key: d.key, min: row.min, max: row.max } : d;
  });
}

export interface DailyNotification {
  id: number;
  title: string;
  body: string;
  schedule: { on: { hour: number; minute: number }; every: "day"; allowWhileIdle: true };
}

/** Repeating daily reminders for the enabled items. Disabled or
 *  unparseable items are skipped. */
export function buildDailyNotifications(items: ScheduleItem[], titleFor: (key: string) => string): DailyNotification[] {
  const out: DailyNotification[] = [];
  for (const item of items) {
    if (!item.enabled) continue;
    const t = parseTime(item.time);
    if (!t) continue;
    out.push({
      id: routineNotificationId(item.key),
      title: titleFor(item.key),
      body: item.message,
      schedule: { on: { hour: t.hour, minute: t.minute }, every: "day", allowWhileIdle: true },
    });
  }
  return out;
}

/**
 * The milestone to show "right now": the latest one whose time has passed.
 * Before the first checkpoint of the day there is no current target, so the
 * caller shows the next upcoming one instead.
 */
export function milestoneForNow(
  milestones: Milestone[],
  timeForKey: (key: string) => string,
  now: Date = new Date(),
): { current: Milestone | null; next: Milestone | null } {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sorted = [...milestones].sort((a, b) => minutesOf(timeForKey(a.key)) - minutesOf(timeForKey(b.key)));
  let current: Milestone | null = null;
  let next: Milestone | null = null;
  for (const m of sorted) {
    if (minutesOf(timeForKey(m.key)) <= nowMin) current = m;
    else if (!next) next = m;
  }
  return { current, next };
}

/**
 * Consecutive-day streak of done days ending today; a not-yet-logged today
 * does not break the streak (the day is still in progress), so we then count
 * back from yesterday.
 */
export function computeStreak(doneDates: string[], today: string): number {
  const done = new Set(doneDates);
  const day = new Date(today + "T00:00:00");
  if (!done.has(today)) day.setDate(day.getDate() - 1);
  let streak = 0;
  for (;;) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if (!done.has(key)) break;
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}

export interface ReportCheckpoint {
  label: string;
  // true = target covered by income entries LOGGED by the checkpoint time
  // (entry logging time, not actual earning time). false = not confirmed
  // from recorded entries - never read as "actually missed": entries may be
  // incomplete or logged late. null = its time has not come yet.
  met: boolean | null;
  // true = nothing was logged by the checkpoint time at all.
  noData?: boolean;
}

/** Plain-text WhatsApp summary, Romanized Hinglish, no auto-send. */
export function buildDailyReportText(input: {
  dateLabel: string;
  income: number;
  expense: number;
  habitsDone: number;
  habitsTotal: number;
  checkpoints: ReportCheckpoint[];
}): string {
  const net = input.income - input.expense;
  const lines = [
    `Driver Saathi - Daily Report (${input.dateLabel})`,
    `Kamai: ${formatINR(input.income)}`,
    `Kharch: ${formatINR(input.expense)}`,
    `Net: ${formatINR(net)}`,
    `Habits: ${input.habitsDone}/${input.habitsTotal} complete`,
  ];
  // Evidence-framed: a checkpoint can be "covered" by entries logged
  // before its time, but never "missed" - low recorded income may just mean
  // late or incomplete logging. Unconfirmed and no-entry checkpoints are
  // reported separately and never folded into a success or failure count.
  const judged = input.checkpoints.filter((c) => c.met !== null);
  if (judged.length > 0) {
    const covered = judged.filter((c) => c.met).length;
    const noEntry = judged.filter((c) => c.noData).length;
    const notConfirmed = judged.length - covered - noEntry;
    const parts = [`${covered} covered`];
    if (notConfirmed > 0) parts.push(`${notConfirmed} not confirmed`);
    if (noEntry > 0) parts.push(`${noEntry} no entry`);
    lines.push(`Checkpoints: ${parts.join(", ")} (entry log time, actual earning time nahi)`);
  }
  lines.push("- Driver Saathi se share kiya");
  return lines.join("\n");
}

export interface TxLike {
  type?: string;
  amount?: unknown;
  transaction_date?: string;
  created_at?: string;
}

/** Income earned on dateKey ("YYYY-MM-DD" local) up to a local "HH:MM"
 *  cutoff, using each entry's created_at for timing. Checkpoints are judged
 *  by what was actually earned by their deadline, never by the day's
 *  eventual total. Entries with an unparseable created_at are excluded from
 *  the timed sum (they still count in whole-day totals elsewhere).
 *  Returns the total and how many entries made it in, so callers can tell
 *  "earned nothing" apart from "logged nothing". */
export function incomeEarnedBy(
  txs: TxLike[],
  dateKey: string,
  time: string,
): { total: number; count: number } {
  const cutoff = minutesOf(time);
  let total = 0;
  let count = 0;
  for (const tx of txs) {
    if (tx.type !== "income" || tx.transaction_date !== dateKey) continue;
    const stamp = tx.created_at ? new Date(tx.created_at) : null;
    if (!stamp || Number.isNaN(stamp.getTime())) continue;
    const mins = stamp.getHours() * 60 + stamp.getMinutes();
    if (mins > cutoff) continue;
    const amt = Number(tx.amount);
    if (!Number.isFinite(amt)) continue;
    total += amt;
    count += 1;
  }
  return { total, count };
}
