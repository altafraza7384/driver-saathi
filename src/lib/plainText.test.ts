import { describe, it, expect } from "vitest";
import { stripMarkdown } from "./plainText";

describe("stripMarkdown (AI replies shown as plain text)", () => {
  it("unclosed bold from a cut-off Finance AI reply", () => {
    expect(stripMarkdown("2. Kharch kami kara\n3. **Bajat")).toBe("2. Kharch kami kara\n3. Bajat");
  });
  it("headings, bold, italics, bullets, code, tables, links", () => {
    expect(stripMarkdown("## Summary\n**Income:** \u20b91300\n* Fuel: *\u20b9900*\n- Net: `\u20b9400`\n__total__ _ok_\n[link](http://x)"))
      .toBe("Summary\nIncome: \u20b91300\nFuel: \u20b9900\nNet: \u20b9400\ntotal ok\nlink");
    expect(stripMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).not.toMatch(/[|]/);
  });
  it("keeps math and normal text", () => {
    expect(stripMarkdown("300 * 3 = 900")).toBe("300 * 3 = 900");
    expect(stripMarkdown("1300 - 900 = 400")).toBe("1300 - 900 = 400");
    expect(stripMarkdown("Aapne \u20b9100 kamaye")).toBe("Aapne \u20b9100 kamaye");
  });
  it("space before the rupee sign ('an\u20b9100')", () => {
    expect(stripMarkdown("Should I save an\u20b9100 income?")).toBe("Should I save an \u20b9100 income?");
    expect(stripMarkdown("Should I save an\u202f\u20b9100 income?")).toBe("Should I save an \u20b9100 income?");
    expect(stripMarkdown("an **\u20b9100** Ride Earnings")).toBe("an \u20b9100 Ride Earnings");
  });
});
