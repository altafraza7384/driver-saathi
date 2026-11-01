import { describe, it, expect } from "vitest";
import {
  classifyText, detectLang, resolveReminderDate, parseReminderTime, resolveReminder, notifyAtUtc,
  istContextLine, stripMarkdown, finalizeReply, LANG_HINT, type ChatMsg,
} from "../src/aiLogic";

// Sunday 1 Nov 2026, 18:03 IST (12:33 UTC) -- the evening Altaf filmed the bug.
const NOW = new Date("2026-11-01T12:33:00.000Z");
const u = (content: string): ChatMsg => ({ role: "user", content });
const a = (content: string): ChatMsg => ({ role: "assistant", content });

describe("detectLang: Roman Hindi and friends", () => {
  it("Altaf's exact phrases are Roman Hindi (were English before v8)", () => {
    expect(detectLang([u("hi kya haal hai")])).toBe("hi-roman");
    expect(detectLang([u("reminder lagao Subah ka")])).toBe("hi-roman");
    expect(detectLang([u("cal ka lagao 7:00 Baje")])).toBe("hi-roman");
  });
  it("more driver Hinglish", () => {
    for (const t of ["aaj 500 kamaye", "petrol mein 300 lage", "mera kharcha kitna hua", "kal subah 7 baje yaad dilana",
      "bhai aaj kitni sawari hui", "gaadi ki service karani hai", "theek hai save kar do"]) {
      expect(classifyText(t), t).toBe("hi-roman");
    }
  });
  it("Roman Marathi", () => {
    for (const t of ["mala aaj 500 rupaye milale", "maza kharch kiti zala", "tumhi kasa aahat", "udya sakali reminder lav"]) {
      expect(classifyText(t), t).toBe("mr-roman");
    }
  });
  it("Roman Bengali", () => {
    for (const t of ["ami aaj 500 taka kamalam", "kemon acho", "amar khoroch koto holo"]) expect(classifyText(t), t).toBe("bn-roman");
  });
  it("Roman Kannada", () => {
    for (const t of ["naanu ivattu 500 rupayi sampadane maadide", "hege idira", "nanna kharchu eshtu"]) expect(classifyText(t), t).toBe("kn-roman");
  });
  it("pure English stays English", () => {
    for (const t of ["hi how are you", "I earned 500 today", "set a reminder for tomorrow at 7 am", "what is my total expense this month"]) {
      expect(classifyText(t), t).toBe("en");
    }
  });
  it("native scripts unchanged (Finance AI Marathi keeps working)", () => {
    expect(classifyText("\u092e\u0932\u093e \u092c\u091a\u0924 \u0915\u0936\u0940 \u0915\u0930\u093e\u092f\u091a\u0940 \u0906\u0939\u0947")).toBe("mr");
    expect(classifyText("\u092e\u0941\u091d\u0947 \u092c\u091a\u0924 \u0915\u0948\u0938\u0947 \u0915\u0930\u0928\u0940 \u0939\u0948")).toBe("hi-dev");
    expect(classifyText("\u0986\u09ae\u09bf \u0986\u099c \u09eb\u09e6\u09e6 \u099f\u09be\u0995\u09be")).toBe("bn");
    expect(classifyText("\u0ca8\u0cbe\u0ca8\u0cc1 \u0c87\u0c82\u0ca6\u0cc1")).toBe("kn");
  });
  it("sticky: a short/ambiguous message keeps the previous language", () => {
    expect(detectLang([u("hi kya haal hai"), a("Main theek hoon"), u("ok")])).toBe("hi-roman");
    expect(detectLang([u("reminder lagao Subah ka"), a("Kis din?"), u("7:00")])).toBe("hi-roman");
    expect(detectLang([u("I earned 500 today"), a("Save it?"), u("haan")])).toBe("en");
    expect(detectLang([u("mala aaj 500 rupaye milale"), a("..."), u("yes")])).toBe("mr-roman");
    expect(detectLang([u("ok")])).toBe("en");
  });
  it("a clear switch of language is followed", () => {
    expect(detectLang([u("hi kya haal hai"), a("..."), u("please tell me my total expense this month")])).toBe("en");
  });
  it("every language has a hint", () => {
    for (const l of ["en", "hi-roman", "hi-dev", "mr", "mr-roman", "bn", "bn-roman", "kn", "kn-roman"] as const) expect(LANG_HINT[l]).toMatch(/Language rule/);
  });
});

describe("reminder day", () => {
  it("relative words in IST", () => {
    expect(resolveReminderDate("aaj", NOW)).toBe("2026-11-01");
    expect(resolveReminderDate("kal", NOW)).toBe("2026-11-02");
    expect(resolveReminderDate("cal ka lagao 7:00 Baje", NOW)).toBe("2026-11-02");
    expect(resolveReminderDate("parso", NOW)).toBe("2026-11-03");
    expect(resolveReminderDate("tomorrow", NOW)).toBe("2026-11-02");
    expect(resolveReminderDate("day after tomorrow", NOW)).toBe("2026-11-03");
    expect(resolveReminderDate("\u0915\u0932", NOW)).toBe("2026-11-02");
    expect(resolveReminderDate("udya", NOW)).toBe("2026-11-02");
  });
  it("IST date, not UTC: 00:30 IST on 2 Nov is already 'aaj' = 2 Nov", () => {
    expect(resolveReminderDate("aaj", new Date("2026-11-01T19:00:00Z"))).toBe("2026-11-02");
  });
  it("explicit dates", () => {
    expect(resolveReminderDate("2026-11-05", NOW)).toBe("2026-11-05");
    expect(resolveReminderDate("05-11-2026", NOW)).toBe("2026-11-05");
    expect(resolveReminderDate("5 Nov", NOW)).toBe("2026-11-05");
    expect(resolveReminderDate("5/11", NOW)).toBe("2026-11-05");
    expect(resolveReminderDate("15 oct", NOW)).toBe("2027-10-15");
    expect(resolveReminderDate("somvar", NOW)).toBe("2026-11-02");
    expect(resolveReminderDate("2026-02-30", NOW)).toBeNull();
    expect(resolveReminderDate("subah", NOW)).toBeNull();
  });
});

describe("reminder time", () => {
  const t = (s: string) => parseReminderTime(s)?.time ?? null;
  it("driver speech", () => {
    expect(t("7:00 Baje")).toBe("07:00");
    expect(t("7 baje")).toBe("07:00");
    expect(t("subah 7 baje")).toBe("07:00");
    expect(t("shaam 6 baje")).toBe("18:00");
    expect(t("shaam 6:30")).toBe("18:30");
    expect(t("raat 9 baje")).toBe("21:00");
    expect(t("raat 1 baje")).toBe("01:00");
    expect(t("dopahar 2 baje")).toBe("14:00");
    expect(t("saade 7")).toBe("07:30");
    expect(t("shaam saade 7")).toBe("19:30");
    expect(t("sava 8")).toBe("08:15");
    expect(t("paune 9")).toBe("08:45");
    expect(t("dedh baje")).toBe("01:30");
    expect(t("7pm")).toBe("19:00");
    expect(t("7 am")).toBe("07:00");
    expect(t("19:30")).toBe("19:30");
    expect(t("saat baje")).toBe("07:00");
    expect(t("subah saat baje")).toBe("07:00");
  });
  it("part of day alone gives a default, marked not explicit", () => {
    expect(parseReminderTime("subah")).toEqual({ time: "08:00", explicit: false });
    expect(parseReminderTime("Subah ka")).toEqual({ time: "08:00", explicit: false });
    expect(parseReminderTime("shaam")).toEqual({ time: "18:00", explicit: false });
  });
  it("no time", () => {
    expect(parseReminderTime("kal")).toBeNull();
    expect(parseReminderTime("2026-11-02")).toBeNull();
    expect(parseReminderTime("5 nov")).toBeNull();
    expect(parseReminderTime(undefined)).toBeNull();
  });
});

describe("resolveReminder -> notify_at", () => {
  it("Altaf's loop case: kal 7:00 baje -> 2 Nov 07:00 IST = 01:30Z", () => {
    expect(resolveReminder({ reminder_date: "2026-11-02", reminder_time: "07:00" }, NOW))
      .toEqual({ date: "2026-11-02", time: "07:00", notifyAt: "2026-11-02T01:30:00.000Z" });
    // model passes raw words instead of formats: still understood
    expect(resolveReminder({ reminder_date: "cal", reminder_time: "7:00 Baje" }, NOW)?.notifyAt).toBe("2026-11-02T01:30:00.000Z");
    expect(resolveReminder({ reminder_date: "kal subah 7 baje" }, NOW)?.notifyAt).toBe("2026-11-02T01:30:00.000Z");
  });
  it("day only -> 09:00 IST (old behaviour kept)", () => {
    expect(resolveReminder({ reminder_date: "2026-11-05" }, NOW)?.notifyAt).toBe("2026-11-05T03:30:00.000Z");
  });
  it("time only -> today if still ahead, else tomorrow", () => {
    expect(resolveReminder({ reminder_time: "20:00" }, NOW)?.date).toBe("2026-11-01");
    expect(resolveReminder({ reminder_time: "07:00" }, NOW)?.date).toBe("2026-11-02");
  });
  it("nothing usable -> null (never a fake save)", () => {
    expect(resolveReminder({ reminder_date: "jab bhi" }, NOW)).toBeNull();
    expect(resolveReminder({}, NOW)).toBeNull();
  });
  it("notify_at is a UTC ISO string the scheduler can compare", () => {
    expect(notifyAtUtc("2026-11-02", "03:00")).toBe("2026-11-01T21:30:00.000Z");
    expect(notifyAtUtc("2026-11-02", "07:00") > new Date("2026-11-02T01:29:00Z").toISOString()).toBe(true);
  });
  it("the model is told today in IST", () => {
    expect(istContextLine(NOW)).toContain("Sunday, 2026-11-01, 18:03");
    expect(istContextLine(NOW)).toContain("Tomorrow (kal) is 2026-11-02");
  });
});

describe("plain text (Finance AI markdown leak)", () => {
  it("unclosed bold from a cut-off Marathi reply", () => {
    expect(stripMarkdown("2. \u0916\u0930\u094d\u091a \u0915\u092e\u0940 \u0915\u0930\u093e\n3. **Bajat")).toBe("2. \u0916\u0930\u094d\u091a \u0915\u092e\u0940 \u0915\u0930\u093e\n3. Bajat");
  });
  it("closed bold, italics, headings, bullets, backticks, tables, links", () => {
    expect(stripMarkdown("## Summary\n**Income:** \u20b91300\n* Fuel: *\u20b9900*\n- Net: `\u20b9400`\n__total__ _ok_\n[link](http://x)"))
      .toBe("Summary\nIncome: \u20b91300\nFuel: \u20b9900\nNet: \u20b9400\ntotal ok\nlink");
    expect(stripMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).not.toMatch(/[|]/);
    expect(stripMarkdown("```\ncode\n```")).toBe("code");
  });
  it("keeps math stars and plain text", () => {
    expect(stripMarkdown("300 * 3 = 900")).toBe("300 * 3 = 900");
    expect(stripMarkdown("1300 - 900 = 400")).toBe("1300 - 900 = 400");
    expect(stripMarkdown("snake_case_name")).toBe("snake_case_name");
  });
  it("space before rupee sign ('an\u20b9100' bug)", () => {
    expect(stripMarkdown("Should I save an\u20b9100 income?")).toBe("Should I save an \u20b9100 income?");
    expect(stripMarkdown("Should I save an\u202f\u20b9100 income?")).toBe("Should I save an \u20b9100 income?");
    expect(stripMarkdown("an **\u20b9100** Ride Earnings")).toBe("an \u20b9100 Ride Earnings");
    expect(stripMarkdown("Total: \u20b9400")).toBe("Total: \u20b9400");
  });
  it("finalizeReply trims a cut-off tail to the last full line", () => {
    expect(finalizeReply("1. Pahila mudda.\n2. Dusra mudda.\n3. **Bajat", true)).toBe("1. Pahila mudda.\n2. Dusra mudda.");
    expect(finalizeReply("Complete reply. **Bold**", false)).toBe("Complete reply. Bold");
  });
});
