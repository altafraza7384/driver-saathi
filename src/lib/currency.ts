/**
 * Coerce an unknown stored value into a safe amount.
 *
 * Firestore documents contain only the fields the writing form sent —
 * there are no DB column defaults like Supabase had — and some docs hold
 * amounts as strings. Every money computation must go through this
 * instead of a bare Number(...): Number(undefined) is NaN, and one NaN
 * poisons the whole sum and renders as "₹NaN".
 */
export function toAmount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Clamp a computed percentage into the 0–100 range a progress bar needs. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Format a number as Indian Rupees with Indian numbering system (lakhs, crores)
 */
export function formatINR(amount: number, showSymbol = true): string {
  const isNegative = amount < 0;
  const abs = Math.abs(amount);
  const symbol = showSymbol ? "₹" : "";

  // Indian numbering: 1,00,000 = 1 lakh, 1,00,00,000 = 1 crore
  const formatted = abs.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return `${isNegative ? "-" : ""}${symbol}${formatted}`;
}

/**
 * Compact format for large numbers (e.g., 1.5L, 2.3Cr)
 */
export function formatINRCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (abs >= 10000000) {
    return `${sign}₹${(abs / 10000000).toFixed(1)}Cr`;
  }
  if (abs >= 100000) {
    return `${sign}₹${(abs / 100000).toFixed(1)}L`;
  }
  if (abs >= 1000) {
    return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  }
  return `${sign}₹${abs}`;
}
