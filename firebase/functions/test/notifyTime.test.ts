import { describe, it, expect } from "vitest";
import { notifyInstant, notifyQueryBounds, isDueNow } from "../src/notifyTime";

// 2 Nov 2026, 04:30 IST = 1 Nov 23:00 UTC (Altaf's 04:28 test).
const now = new Date("2026-11-01T23:00:00.000Z");

describe("notifyInstant", () => {
  it("reads chat's UTC ISO value as is", () => {
    expect(notifyInstant("2026-11-01T22:58:00.000Z")?.toISOString()).toBe("2026-11-01T22:58:00.000Z");
  });
  it("reads a page's naive value as IST", () => {
    expect(notifyInstant("2026-11-02T04:28:00")?.toISOString()).toBe("2026-11-01T22:58:00.000Z");
    expect(notifyInstant("2026-11-02T04:28")?.toISOString()).toBe("2026-11-01T22:58:00.000Z");
  });
  it("reads a date-only value as 09:00 IST", () => {
    expect(notifyInstant("2026-11-02")?.toISOString()).toBe("2026-11-02T03:30:00.000Z");
  });
  it("honours an explicit offset", () => {
    expect(notifyInstant("2026-11-02T04:28:00+05:30")?.toISOString()).toBe("2026-11-01T22:58:00.000Z");
  });
  it("reads a Firestore Timestamp", () => {
    expect(notifyInstant({ toDate: () => new Date("2026-11-01T22:58:00.000Z") })?.toISOString()).toBe("2026-11-01T22:58:00.000Z");
  });
  it("rejects junk", () => {
    expect(notifyInstant("kal subah")).toBeNull();
    expect(notifyInstant(null)).toBeNull();
    expect(notifyInstant(42)).toBeNull();
  });
});

describe("isDueNow", () => {
  it("chat reminder for 04:28 IST is due at 04:30 IST", () => {
    expect(isDueNow("2026-11-01T22:58:00.000Z", now)).toBe(true);
  });
  it("page reminder for 04:28 IST is due at 04:30 IST (was 5h30m late)", () => {
    expect(isDueNow("2026-11-02T04:28:00", now)).toBe(true);
  });
  it("page reminder for 04:35 IST is not due yet at 04:30 IST", () => {
    expect(isDueNow("2026-11-02T04:35:00", now)).toBe(false);
  });
  it("items older than 24h are not sent", () => {
    expect(isDueNow("2026-10-31T22:00:00.000Z", now)).toBe(false);
  });
});

describe("notifyQueryBounds", () => {
  it("string range fetches both shapes for the same due item", () => {
    const { from, to } = notifyQueryBounds(now);
    for (const v of ["2026-11-01T22:58:00.000Z", "2026-11-02T04:28:00"]) {
      expect(v >= from && v <= to).toBe(true);
    }
  });
});
