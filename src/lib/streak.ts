// Daily-entry streak: consecutive local days (YYYY-MM-DD) with at least
// one transaction. Local dates only, never UTC (same rule as budgets).
// Grace rule: if today has no entry yet, the streak is still alive when
// yesterday has one — the driver has until tonight to keep it going.

export function prevDayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  dt.setDate(dt.getDate() - 1);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export function daysAgoStr(today: string, n: number): string {
  let cursor = today;
  for (let i = 0; i < n; i++) cursor = prevDayStr(cursor);
  return cursor;
}

export function calcStreak(dateStrs: string[], today: string): number {
  const set = new Set(dateStrs);
  let cursor = set.has(today) ? today : prevDayStr(today);
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = prevDayStr(cursor);
  }
  return streak;
}
