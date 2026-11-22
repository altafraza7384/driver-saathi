import { describe, expect, it } from "vitest";
import {retimeForMode, SCHEDULE_KEYS, schedulePreset,
  DEFAULT_MILESTONES,
  DEFAULT_SCHEDULE,
  NIGHT_SCHEDULE,
  buildDailyNotifications,
  buildDailyReportText,
  canShareDailyReport,
  computeStreak,
  formatCheckpointLabel,
  habitLogId,
  isHabitDone,
  mergeMilestones,
  mergeSchedule,
  milestoneForNow,
  minutesOf,
  parseTime,
  planHabitToggle,
  routineNotificationId,
  summarizeRoutineSave,
  validateMilestone,
  incomeEarnedBy,
} from "@/lib/routine";

describe("routineNotificationId", () => {
  it("is stable for the same key and differs across keys", () => {
    expect(routineNotificationId("wake")).toBe(routineNotificationId("wake"));
    expect(routineNotificationId("wake")).not.toBe(routineNotificationId("depart"));
  });

  it("fits a positive 32-bit Java int (Android requirement)", () => {
    for (const key of ["wake", "depart", "cp1", "cp2", "cp3", "cp4", "day_end"]) {
      const id = routineNotificationId(key);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(2_000_000_000);
      expect(Number.isInteger(id)).toBe(true);
    }
  });
});

describe("parseTime / minutesOf", () => {
  it("parses HH:MM", () => {
    expect(parseTime("07:30")).toEqual({ hour: 7, minute: 30 });
    expect(minutesOf("13:30")).toBe(810);
  });

  it("rejects bad values", () => {
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("7:99")).toBeNull();
    expect(parseTime("abc")).toBeNull();
  });
});

describe("mergeSchedule / mergeMilestones", () => {
  it("falls back to defaults when nothing is stored", () => {
    expect(mergeSchedule([])).toEqual(DEFAULT_SCHEDULE);
    expect(mergeMilestones([])).toEqual(DEFAULT_MILESTONES);
  });

  it("stored rows override defaults; unknown keys are ignored", () => {
    const merged = mergeSchedule([{ key: "wake", time: "06:45", enabled: false, message: "custom" }]);
    expect(merged.find((s) => s.key === "wake")).toEqual({ key: "wake", time: "06:45", enabled: false, message: "custom" });
    expect(merged.find((s) => s.key === "depart")).toEqual(DEFAULT_SCHEDULE.find((s) => s.key === "depart"));

    const ms = mergeMilestones([{ key: "cp1", min: 600, max: 800 }]);
    expect(ms.find((m) => m.key === "cp1")).toEqual({ key: "cp1", min: 600, max: 800 });
  });
});

describe("buildDailyNotifications", () => {
  const titles = (key: string) => `title-${key}`;

  it("schedules only enabled items with valid times", () => {
    const notes = buildDailyNotifications(
      [
        { key: "wake", time: "07:00", enabled: true, message: "m1" },
        { key: "depart", time: "07:30", enabled: false, message: "m2" },
        { key: "cp1", time: "bad", enabled: true, message: "m3" },
      ],
      titles,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(routineNotificationId("wake"));
    expect(notes[0].schedule.on).toEqual({ hour: 7, minute: 0 });
    expect(notes[0].schedule.every).toBe("day");
    expect(notes[0].title).toBe("title-wake");
  });
});

describe("milestoneForNow", () => {
  const FIXTURE = [
    { key: "cp1", min: 500, max: 700 },
    { key: "cp2", min: 1000, max: 1400 },
    { key: "cp3", min: 1500, max: 2100 },
    { key: "cp4", min: 2200, max: 3000 },
    { key: "day_end", min: 2500, max: 3500 },
  ];
  const times: Record<string, string> = { cp1: "10:30", cp2: "13:30", cp3: "17:00", cp4: "21:00", day_end: "22:00" };
  const timeForKey = (k: string) => times[k];
  const at = (h: number, m: number) => new Date(2026, 10, 21, h, m);

  it("returns the latest passed milestone as current", () => {
    const { current } = milestoneForNow(FIXTURE, timeForKey, at(14, 0));
    expect(current?.key).toBe("cp2");
  });

  it("before the first checkpoint, next is the first milestone", () => {
    const { current, next } = milestoneForNow(FIXTURE, timeForKey, at(8, 0));
    expect(current).toBeNull();
    expect(next?.key).toBe("cp1");
  });

  it("after day end, current is the day milestone and next is null", () => {
    const { current, next } = milestoneForNow(FIXTURE, timeForKey, at(22, 30));
    expect(current?.key).toBe("day_end");
    expect(next).toBeNull();
  });
});

describe("computeStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(computeStreak(["2026-11-19", "2026-11-20", "2026-11-21"], "2026-11-21")).toBe(3);
  });

  it("a not-yet-logged today does not break the streak", () => {
    expect(computeStreak(["2026-11-19", "2026-11-20"], "2026-11-21")).toBe(2);
  });

  it("a missed yesterday resets to zero when today is also missing", () => {
    expect(computeStreak(["2026-11-19"], "2026-11-21")).toBe(0);
  });

  it("a gap in the middle stops the count", () => {
    expect(computeStreak(["2026-11-18", "2026-11-20", "2026-11-21"], "2026-11-21")).toBe(2);
  });
});

describe("buildDailyReportText", () => {
  it("includes totals, habits and only due checkpoints", () => {
    const text = buildDailyReportText({
      dateLabel: "21 Nov 2026",
      income: 2500,
      expense: 700,
      habitsDone: 2,
      habitsTotal: 3,
      checkpoints: [
        { label: "10:30", met: true },
        { label: "13:30", met: false }, // logged but below target: not confirmed
        { label: "15:00", met: false, noData: true }, // nothing logged: no entry
        { label: "17:00", met: null }, // upcoming: excluded entirely
      ],
    });
    expect(text).toContain("21 Nov 2026");
    expect(text).toContain("₹2,500");
    expect(text).toContain("₹1,800"); // net
    expect(text).toContain("2/3");
    expect(text).toContain("1 covered");
    expect(text).toContain("1 not confirmed"); // never asserted as missed
    expect(text).toContain("1 no entry");
    expect(text).toContain("entry log time");
    expect(text).not.toContain("17:00");
    expect(text).not.toContain("missed");
  });

  it("omits not-confirmed and no-entry segments when everything due is covered", () => {
    const text = buildDailyReportText({
      dateLabel: "21 Nov 2026",
      income: 2500,
      expense: 700,
      habitsDone: 3,
      habitsTotal: 3,
      checkpoints: [
        { label: "10:30", met: true },
        { label: "13:30", met: true },
        { label: "17:00", met: null },
      ],
    });
    expect(text).toContain("2 covered");
    expect(text).not.toContain("not confirmed");
    expect(text).not.toContain("no entry");
  });
});

describe("canShareDailyReport", () => {
  it("allows sharing only once every load has settled successfully", () => {
    expect(canShareDailyReport(false, false)).toBe(true);
    expect(canShareDailyReport(true, false)).toBe(false); // still loading
    expect(canShareDailyReport(false, true)).toBe(false); // load failed
    expect(canShareDailyReport(true, true)).toBe(false);
  });
});

describe("incomeEarnedBy", () => {
  const day = "2026-11-21";
  // created_at is UTC; local box is IST (+5:30) - build stamps from local times
  const at = (h: number, m: number) => {
    const d = new Date(2026, 10, 21, h, m);
    return d.toISOString();
  };
  const txs = [
    { type: "income", amount: 400, transaction_date: day, created_at: at(9, 0) },
    { type: "income", amount: 250, transaction_date: day, created_at: at(11, 40) },
    { type: "expense", amount: 120, transaction_date: day, created_at: at(9, 30) },
    { type: "income", amount: 900, transaction_date: "2026-11-20", created_at: at(8, 0) },
    { type: "income", amount: 50, transaction_date: day, created_at: "not-a-date" },
  ];

  it("counts only income earned by the checkpoint time", () => {
    expect(incomeEarnedBy(txs, day, "10:30")).toEqual({ total: 400, count: 1 });
    expect(incomeEarnedBy(txs, day, "13:30")).toEqual({ total: 650, count: 2 });
  });

  it("excludes expenses, other days and unparseable timestamps", () => {
    expect(incomeEarnedBy(txs, day, "23:59").total).toBe(650);
  });

  it("zero count means nothing logged by then, not zero earned", () => {
    expect(incomeEarnedBy(txs, day, "08:00")).toEqual({ total: 0, count: 0 });
  });
});


describe("schedulePreset (Day/Night reminder timings only)", () => {
  it("day preset is the existing default schedule", () => {
    expect(schedulePreset("day")).toBe(DEFAULT_SCHEDULE);
  });

  it("night preset covers every schedule key with valid times and messages", () => {
    const night = schedulePreset("night");
    expect(night.map((i) => i.key).sort()).toEqual([...SCHEDULE_KEYS].sort());
    for (const item of night) {
      expect(parseTime(item.time)).not.toBeNull();
      expect(item.message.length).toBeGreaterThan(0);
    }
  });

  it("entry nudges are folded into existing beats, not extra notifications", () => {
    // day preset: cp2 (lunch) and day_end carry the entry reminders
    expect(DEFAULT_SCHEDULE.find((i) => i.key === "cp2")?.message).toContain("entry");
    expect(DEFAULT_SCHEDULE.find((i) => i.key === "day_end")?.message).toContain("entry");
    // night preset: same two beats carry them
    const night = schedulePreset("night");
    expect(night.find((i) => i.key === "cp2")?.message).toContain("entry");
    expect(night.find((i) => i.key === "day_end")?.message).toContain("entry");
    // no schedule item fires twice: keys stay unique
    expect(new Set(night.map((i) => i.key)).size).toBe(night.length);
  });
});

describe("buildDailyNotifications target suffix", () => {
  const items = [
    { key: "cp1", time: "10:30", enabled: true, message: "Checkpoint 1: hisaab lagao." },
    { key: "wake", time: "07:00", enabled: true, message: "Utho." },
    { key: "cp2", time: "13:30", enabled: true, message: "Checkpoint 2." },
  ];
  const titleFor = (k: string) => `title:${k}`;

  it("appends the saved trial target for checkpoints with a set milestone", () => {
    const n = buildDailyNotifications(items, titleFor, [{ key: "cp1", min: 500, max: 700 }]);
    const cp1 = n.find((x) => x.title === "title:cp1")!;
    expect(cp1.body).toContain("₹500–₹700");
    expect(cp1.body).toContain("guarantee nahi");
    expect(cp1.body).toContain("hisaab lagao.");
  });

  it("omits the suffix for unset milestones and non-checkpoint keys", () => {
    const n = buildDailyNotifications(items, titleFor, [{ key: "cp2", min: 0, max: 0 }]);
    expect(n.find((x) => x.title === "title:cp2")!.body).toBe("Checkpoint 2.");
    expect(n.find((x) => x.title === "title:wake")!.body).toBe("Utho.");
  });
});

describe("retimeForMode", () => {
  it("remaps only default times; custom times, enabled flags and messages survive a round trip", () => {
    const custom = schedulePreset("day").map((i) =>
      i.key === "cp1" ? { ...i, time: "11:15", message: "mera custom msg" } : i.key === "cp2" ? { ...i, enabled: false } : i,
    );
    const night = retimeForMode(custom, "day", "night");
    // default times moved to the night preset
    expect(night.find((i) => i.key === "wake")?.time).toBe("17:00");
    // custom time kept
    expect(night.find((i) => i.key === "cp1")?.time).toBe("11:15");
    expect(night.find((i) => i.key === "cp1")?.message).toBe("mera custom msg");
    // enabled flag kept
    expect(night.find((i) => i.key === "cp2")?.enabled).toBe(false);
    // toggling back restores defaults for untouched fields, keeps customs
    const backToDay = retimeForMode(night, "night", "day");
    expect(backToDay.find((i) => i.key === "wake")?.time).toBe("07:00");
    expect(backToDay.find((i) => i.key === "cp1")?.time).toBe("11:15");
  });
});

describe("habitLogId / planHabitToggle / isHabitDone", () => {
  type Row = { id: string; habit_id: string; date: string; done: boolean };

  // In-memory stand-in for the habit_logs collection: a Map keyed by doc
  // id mirrors setDoc-with-id (a repeat write overwrites) and deleteDoc.
  // The page executes exactly the plan computed here.
  const applyPlan = (store: Map<string, Row>, plan: ReturnType<typeof planHabitToggle>, habitId: string, date: string, done: boolean) => {
    if (plan.writeId) store.set(plan.writeId, { id: plan.writeId, habit_id: habitId, date, done });
    for (const id of plan.deleteIds) store.delete(id);
  };
  const toggle = (store: Map<string, Row>, habitId: string, date: string, done: boolean) =>
    applyPlan(store, planHabitToggle([...store.values()], habitId, date, done), habitId, date, done);

  it("gives one stable id per habit+date", () => {
    expect(habitLogId("h1", "2026-11-22")).toBe("h1_2026-11-22");
    expect(habitLogId("h1", "2026-11-22")).toBe(habitLogId("h1", "2026-11-22"));
    expect(habitLogId("h1", "2026-11-22")).not.toBe(habitLogId("h2", "2026-11-22"));
    expect(habitLogId("h1", "2026-11-22")).not.toBe(habitLogId("h1", "2026-11-23"));
  });

  it("double check-toggle creates exactly one log", () => {
    const store = new Map<string, Row>();
    // Both taps read the same not-yet-refreshed cache (no log yet), so
    // both plans are computed from the empty state — as in the real race.
    const plan1 = planHabitToggle([], "h1", "2026-11-22", true);
    const plan2 = planHabitToggle([], "h1", "2026-11-22", true);
    applyPlan(store, plan1, "h1", "2026-11-22", true);
    applyPlan(store, plan2, "h1", "2026-11-22", true);
    expect(store.size).toBe(1);
    expect(isHabitDone([...store.values()], "h1", "2026-11-22")).toBe(true);
  });

  it("uncheck removes the log and the habit reads unchecked", () => {
    const store = new Map<string, Row>();
    toggle(store, "h1", "2026-11-22", true);
    toggle(store, "h1", "2026-11-22", false);
    expect(store.size).toBe(0);
    expect(isHabitDone([...store.values()], "h1", "2026-11-22")).toBe(false);
  });

  it("uncheck also removes legacy duplicate logs, so the habit cannot stay checked", () => {
    // Two docs for the same habit+date, as the old race created them: the
    // deterministic doc plus one with a random id.
    const store = new Map<string, Row>([
      ["h1_2026-11-22", { id: "h1_2026-11-22", habit_id: "h1", date: "2026-11-22", done: true }],
      ["legacy-random-id", { id: "legacy-random-id", habit_id: "h1", date: "2026-11-22", done: true }],
    ]);
    toggle(store, "h1", "2026-11-22", false);
    expect(store.size).toBe(0);
    expect(isHabitDone([...store.values()], "h1", "2026-11-22")).toBe(false);
  });

  it("leaves other habits and dates alone", () => {
    const store = new Map<string, Row>();
    toggle(store, "h1", "2026-11-22", true);
    toggle(store, "h2", "2026-11-22", true);
    toggle(store, "h1", "2026-11-21", true);
    toggle(store, "h1", "2026-11-22", false);
    expect(store.size).toBe(2);
    expect(isHabitDone([...store.values()], "h1", "2026-11-22")).toBe(false);
    expect(isHabitDone([...store.values()], "h2", "2026-11-22")).toBe(true);
    expect(isHabitDone([...store.values()], "h1", "2026-11-21")).toBe(true);
  });
});

describe("night preset (midnight-crossing reminder times)", () => {
  it("has the exact night times, including checkpoints past midnight", () => {
    const night = schedulePreset("night");
    expect(night).toBe(NIGHT_SCHEDULE);
    const timeFor = (key: string) => night.find((i) => i.key === key)?.time;
    expect(timeFor("wake")).toBe("17:00");
    expect(timeFor("depart")).toBe("17:30");
    expect(timeFor("cp1")).toBe("20:00");
    expect(timeFor("cp2")).toBe("23:00");
    // After midnight, still the same shift's checkpoints.
    expect(timeFor("cp3")).toBe("02:00");
    expect(timeFor("cp4")).toBe("05:00");
    expect(timeFor("day_end")).toBe("06:00");
  });

  it("differs from the day preset on every key", () => {
    const night = schedulePreset("night");
    for (const item of DEFAULT_SCHEDULE) {
      expect(night.find((i) => i.key === item.key)?.time).not.toBe(item.time);
    }
  });

  it("schedules the night checkpoints with stable ids", () => {
    const notes = buildDailyNotifications(schedulePreset("night"), (k) => `title-${k}`, []);
    expect(notes).toHaveLength(7);
    const byKey = new Map(notes.map((n) => [n.title.replace("title-", ""), n]));
    expect(byKey.get("cp3")?.schedule.on).toEqual({ hour: 2, minute: 0 });
    expect(byKey.get("cp4")?.schedule.on).toEqual({ hour: 5, minute: 0 });
    expect(byKey.get("day_end")?.schedule.on).toEqual({ hour: 6, minute: 0 });
    // Same ids as the day preset: the id depends only on the key, never
    // on the time, so retiming never leaves a stale duplicate behind.
    for (const key of SCHEDULE_KEYS) {
      expect(byKey.get(key)?.id).toBe(routineNotificationId(key));
    }
  });
});

describe("retimeForMode fully-custom schedules", () => {
  it("keeps every custom time across a day -> night -> day round trip", () => {
    const custom = schedulePreset("day").map((i) => ({ ...i, time: "09:09", message: `custom-${i.key}` }));
    const night = retimeForMode(custom, "day", "night");
    expect(night.every((i) => i.time === "09:09")).toBe(true);
    expect(night.every((i) => i.message === `custom-${i.key}`)).toBe(true);
    const back = retimeForMode(night, "night", "day");
    expect(back).toEqual(custom);
  });

  it("never adds fields beyond the ScheduleItem shape", () => {
    const night = retimeForMode(schedulePreset("day"), "day", "night");
    for (const item of night) {
      expect(Object.keys(item).sort()).toEqual(["enabled", "key", "message", "time"]);
    }
    for (const item of schedulePreset("night")) {
      expect(Object.keys(item).sort()).toEqual(["enabled", "key", "message", "time"]);
    }
  });
});

describe("formatCheckpointLabel (incl. midnight checkpoints)", () => {
  it("labels day checkpoints as time + target range", () => {
    expect(formatCheckpointLabel("10:30", 500, 700)).toBe("10:30 (₹500–₹700)");
  });

  it("labels night checkpoints past midnight exactly the same way", () => {
    expect(formatCheckpointLabel("02:00", 1500, 2100)).toBe("02:00 (₹1,500–₹2,100)");
    expect(formatCheckpointLabel("05:00", 2200, 3000)).toBe("05:00 (₹2,200–₹3,000)");
    expect(formatCheckpointLabel("06:00", 2500, 3500)).toBe("06:00 (₹2,500–₹3,500)");
  });

  it("shows the time alone for an unset target", () => {
    expect(formatCheckpointLabel("10:30", 0, 0)).toBe("10:30");
  });

  it("shows the range when only the maximum is set", () => {
    expect(formatCheckpointLabel("13:30", 0, 1400)).toBe("13:30 (₹0–₹1,400)");
  });
});

describe("validateMilestone (target min/max)", () => {
  it("accepts unset, equal, and properly ordered targets", () => {
    expect(validateMilestone(0, 0)).toBeNull();
    expect(validateMilestone(500, 500)).toBeNull();
    expect(validateMilestone(500, 700)).toBeNull();
    expect(validateMilestone(0, 1400)).toBeNull();
  });

  it("rejects a maximum below the minimum", () => {
    expect(validateMilestone(700, 500)).toBe("routine.invalidTarget");
  });

  it("rejects negative amounts", () => {
    expect(validateMilestone(-1, 700)).toBe("routine.invalidTarget");
    expect(validateMilestone(500, -5)).toBe("routine.invalidTarget");
  });

  it("rejects non-finite amounts", () => {
    expect(validateMilestone(NaN, 700)).toBe("routine.invalidTarget");
    expect(validateMilestone(500, Infinity)).toBe("routine.invalidTarget");
  });
});

describe("summarizeRoutineSave (partial-save / retry)", () => {
  it("saved when nothing failed", () => {
    expect(summarizeRoutineSave(0, 13)).toBe("saved");
  });

  it("partial when some rows failed — Save-again retries the failed ones", () => {
    expect(summarizeRoutineSave(1, 13)).toBe("partial");
    expect(summarizeRoutineSave(12, 13)).toBe("partial");
  });

  it("failed only when every row failed", () => {
    expect(summarizeRoutineSave(13, 13)).toBe("failed");
  });
});

describe("routineNotificationId stability across reschedules", () => {
  it("is the same id for a key no matter what time it is scheduled at", () => {
    const day = buildDailyNotifications(schedulePreset("day"), (k) => k, []);
    const night = buildDailyNotifications(schedulePreset("night"), (k) => k, []);
    for (const key of SCHEDULE_KEYS) {
      expect(day.find((n) => n.title === key)?.id).toBe(night.find((n) => n.title === key)?.id);
      expect(day.find((n) => n.title === key)?.id).toBe(routineNotificationId(key));
    }
  });

  it("gives every schedule key a distinct id", () => {
    const ids = SCHEDULE_KEYS.map((k) => routineNotificationId(k));
    expect(new Set(ids).size).toBe(SCHEDULE_KEYS.length);
  });
});

describe("night mode never changes accounting dates/history (pin)", () => {
  it("mode switch changes only reminder times; a transactions fixture is untouched", () => {
    const transactions = [
      { type: "income", amount: 650, transaction_date: "2026-11-21", created_at: "2026-11-21T09:00:00Z" },
      { type: "expense", amount: 300, transaction_date: "2026-11-20", created_at: "2026-11-20T18:00:00Z" },
    ];
    const before = JSON.parse(JSON.stringify(transactions));
    // The whole mode-switch path: preset lookup + retime. Neither takes
    // transactions in, and neither returns anything but ScheduleItems.
    const night = retimeForMode(schedulePreset("day"), "day", "night");
    const back = retimeForMode(night, "night", "day");
    expect(back).toEqual(schedulePreset("day"));
    expect(transactions).toEqual(before);
    // Verified by code inspection (2026-11-22): no migration function
    // exists; RoutinePage's save writes only routine_settings rows, and
    // the only transaction_date use in routine.ts is the read filter in
    // incomeEarnedBy. Transaction writes live only in
    // AddTransactionPage / RecurringExpenses, which the mode switch
    // never calls. This test pins the observable contract: switching
    // modes cannot rewrite a transaction date.
    expect(night.every((i) => Object.keys(i).sort().join() === "enabled,key,message,time")).toBe(true);
  });
});
