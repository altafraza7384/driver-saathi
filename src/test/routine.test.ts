import { describe, expect, it } from "vitest";
import {
  DEFAULT_MILESTONES,
  DEFAULT_SCHEDULE,
  buildDailyNotifications,
  buildDailyReportText,
  computeStreak,
  mergeMilestones,
  mergeSchedule,
  milestoneForNow,
  minutesOf,
  parseTime,
  routineNotificationId,
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
