// Trial state for DISPLAY only. The server (functions getAiLimits) enforces
// the actual AI limits; this helper just reads the user's own profile doc
// (trial_ends_at is server-written — clients can never write it, see rules)
// and turns it into what the UI shows from day 1.
export type TrialState =
  | { kind: "paid" }
  | { kind: "trial"; daysLeft: number }
  | { kind: "notStarted" }
  | { kind: "expired" };

export function parseTrialDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const maybe = v as { toDate?: () => Date; seconds?: number };
  if (typeof maybe.toDate === "function") {
    try { return maybe.toDate(); } catch { return null; }
  }
  if (typeof maybe.seconds === "number") return new Date(maybe.seconds * 1000);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function getTrialState(
  profile: { subscription_plan_id?: string | null; trial_ends_at?: unknown } | null | undefined,
): TrialState {
  if (!profile) return { kind: "notStarted" };
  if (profile.subscription_plan_id) return { kind: "paid" };
  const ends = parseTrialDate(profile.trial_ends_at);
  if (!ends) return { kind: "notStarted" };
  const now = new Date();
  if (now >= ends) return { kind: "expired" };
  // ceil: ends in 2h -> 1 ("aakhri din"), ends in 26h -> 2 ("2 din bache").
  const daysLeft = Math.ceil((ends.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return { kind: "trial", daysLeft };
}

// Popup milestone due today: 2 days left, last day, or expired. Anything
// else returns null. Callers show each milestone at most once per day.
export function trialMilestone(state: TrialState): "2days" | "lastDay" | "expired" | null {
  if (state.kind === "trial" && state.daysLeft === 2) return "2days";
  if (state.kind === "trial" && state.daysLeft === 1) return "lastDay";
  if (state.kind === "expired") return "expired";
  return null;
}
