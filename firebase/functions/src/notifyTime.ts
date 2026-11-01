// Reminder/due-item notify times, as the scheduler reads them.
//
// notify_at is stored as a string in two shapes:
//  - a UTC ISO instant ("2026-11-01T22:58:00.000Z") — chat (ai.ts, v8) and
//    recurring bills write this;
//  - a naive local string ("2026-11-02T04:28:00") — the Reminders, Goals,
//    Debts and Car checks pages write the time the driver typed, with no
//    zone. The app is India-only, so that time is IST.
// The scheduler used to compare every value with new Date().toISOString()
// as plain strings, which read a naive IST time as UTC: page reminders fired
// 5h30m late. These helpers read both shapes as real instants. The query
// range is widened by the IST offset so naive values are fetched too; the
// exact due check then happens in code with isDueNow().

export const IST_OFFSET_MIN = 330;
export const LOOKBACK_MS = 24 * 60 * 60 * 1000;

const ZONED = /(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/** The instant a notify_at value means, or null when it can't be read. */
export function notifyInstant(value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (ZONED.test(s)) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const m = NAIVE.exec(s);
  if (!m) return null;
  // Date only → 09:00 IST, the same default the pages use.
  const [y, mo, d, h, mi, sec] = [+m[1], +m[2], +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0];
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec) - IST_OFFSET_MIN * 60000;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** String bounds for the Firestore range query: wide enough to fetch UTC
 *  values due in the last 24h AND naive IST values due in the same window
 *  (a naive IST string sorts 5h30m "later" than its UTC form). */
export function notifyQueryBounds(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - LOOKBACK_MS).toISOString(),
    to: new Date(now.getTime() + IST_OFFSET_MIN * 60000).toISOString(),
  };
}

/** True when the item's notify time has arrived and is within the lookback. */
export function isDueNow(value: unknown, now: Date): boolean {
  const t = notifyInstant(value);
  if (!t) return false;
  const ms = t.getTime();
  return ms <= now.getTime() && ms >= now.getTime() - LOOKBACK_MS;
}
