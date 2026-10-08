import { describe, expect, it } from "vitest";
import { formatINR, formatINRCompact } from "@/lib/currency";

describe("currency formatting", () => {
  it("formats Indian lakh/crore grouping with rupee symbol", () => {
    expect(formatINR(1234567.89)).toBe("₹12,34,567.89");
    expect(formatINR(1234567.89, false)).toBe("12,34,567.89");
  });

  it("preserves negative values", () => {
    expect(formatINR(-2500)).toBe("-₹2,500");
  });

  it("formats compact values", () => {
    expect(formatINRCompact(1500)).toBe("₹1.5K");
    expect(formatINRCompact(250000)).toBe("₹2.5L");
    expect(formatINRCompact(15000000)).toBe("₹1.5Cr");
  });

  it("handles zero", () => {
    expect(formatINR(0)).toBe("₹0");
    expect(formatINRCompact(0)).toBe("₹0");
  });
});
