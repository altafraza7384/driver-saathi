// Display label for a stored transaction/budget category.
//
// Categories are STORED in English (transactions, budgets and bill
// payments must match byte-for-byte — see src/lib/budgets.ts), but in
// Hindi/Marathi/Bengali/Kannada mode they used to be SHOWN in English too
// ("Ride Earnings", "Fuel"… — QA 2026-11-01). Translate only for display;
// unknown/custom categories are shown as stored.
export function categoryLabel(t: (key: string) => string, category: string | null | undefined): string {
  if (!category) return "";
  const key = `cat.${category}`;
  const label = t(key);
  return label === key ? category : label;
}
