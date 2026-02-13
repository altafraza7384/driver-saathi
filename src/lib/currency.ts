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
