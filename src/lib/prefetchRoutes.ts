// Background route prefetch (2026-10-23, user-approved).
//
// Why: every page in this app is lazy-loaded, so tapping a page for the
// first time after a publish downloads its chunk on the spot — on a slow
// mobile connection that shows up as seconds of spinner on every tap.
// Prefetching the daily-use pages once, while the app is idle, warms the
// browser cache so later taps open instantly.
//
// Safety rules for this prefetch (do not loosen without asking):
// - Runs ONCE per app session, only after the main layout mounts (i.e.
//   only for signed-in users inside the app, never on /auth or /admin).
// - Waits for idle (requestIdleCallback, 3s timeout) plus a 2.5s fallback
//   delay, so the home page's own data loads first, not the prefetch.
// - Skips the full pass on very slow connections (effectiveType
//   slow-2g/2g) and when Data Saver is on, but still warms the 5
//   most-tapped pages after a longer delay, so the slowest users are
//   not left with no prefetch at all (audit 2026-10-24).
// - Deliberately EXCLUDES DataBackupPage (~440 KB, jspdf —
//   rarely opened), all admin pages, and Auth/Privacy/NotFound, so the
//   background download stays around ~200 KB instead of ballooning.
// - Every import is individually try/caught: a failed prefetch changes
//   nothing — that page simply lazy-loads normally when tapped, exactly
//   as it did before this file existed. Prefetching only downloads code;
//   it never renders a page, never runs page logic, and never touches data.

const DAILY_PAGES = [
  () => import("../pages/TransactionsPage"),
  () => import("../pages/AddTransactionPage"),
  () => import("../pages/DebtsPage"),
  () => import("../pages/GoalsPage"),
  () => import("../pages/HealthPage"),
  () => import("../pages/AssistantPage"),
  () => import("../pages/FinanceAIPage"),
  () => import("../pages/MorePage"),
  () => import("../pages/CarChecksPage"),
  () => import("../pages/RemindersPage"),
  () => import("../pages/NotesPage"),
  () => import("../pages/SOSPage"),
  () => import("../pages/CarSosPage"),
  () => import("../pages/InsuranceLeadPage"),
  () => import("../pages/BudgetsPage"),
  () => import("../pages/SettingsPage"),
];

let started = false;

function connectionTooSlow(): boolean {
  try {
    const conn = (navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }).connection;
    if (!conn) return false;
    if (conn.saveData) return true;
    return conn.effectiveType === "slow-2g" || conn.effectiveType === "2g";
  } catch {
    return false;
  }
}

async function runPrefetch(): Promise<void> {
  // 4-at-a-time pool (audit 2026-10-24): the old sequential pass took
  // 16 round-trips before the last page was warm; chunks are 6–25 KB,
  // so modest parallelism warms everything sooner without flooding a
  // mobile connection. Each import is individually try/caught.
  const queue = [...DAILY_PAGES];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length > 0) {
      const load = queue.shift()!;
      try {
        await load();
      } catch {
        // Ignore: the page will lazy-load normally when tapped.
      }
    }
  });
  await Promise.all(workers);
}

export function prefetchRoutes(): void {
  if (started) return;
  started = true;
  if (typeof window === "undefined") return;
  // On slow connections the old code skipped prefetch ENTIRELY, so the
  // slowest users got no help at all (audit 2026-10-24). Now slow
  // networks still warm the 5 most-tapped pages instead of all 16.
  if (connectionTooSlow()) {
    const priority = DAILY_PAGES.slice(0, 5);
    const startSlow = () => {
      const run = async () => {
        for (const load of priority) {
          try { await load(); } catch { /* lazy-load on tap */ }
        }
      };
      if (document.hidden) {
        const onVisible = () => {
          if (!document.hidden) {
            document.removeEventListener("visibilitychange", onVisible);
            void run();
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      void run();
    };
    setTimeout(startSlow, 4000);
    return;
  }

  const start = () => {
    if (document.hidden) {
      const onVisible = () => {
        if (!document.hidden) {
          document.removeEventListener("visibilitychange", onVisible);
          void runPrefetch();
        }
      };
      document.addEventListener("visibilitychange", onVisible);
      return;
    }
    void runPrefetch();
  };

  const ric = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => setTimeout(start, 2500), { timeout: 3000 });
  } else {
    setTimeout(start, 2500);
  }
}
