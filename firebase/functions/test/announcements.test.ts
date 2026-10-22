import { describe, it, expect } from "vitest";
import { announcementMatchesAudience, extractFcmToken, chunkTokens } from "../src/announcements";

describe("announcementMatchesAudience", () => {
  it("all reaches subscribers and non-subscribers", () => {
    expect(announcementMatchesAudience("all", "plan_1")).toBe(true);
    expect(announcementMatchesAudience("all", null)).toBe(true);
  });
  it("non_subscribers reaches only users without a plan", () => {
    expect(announcementMatchesAudience("non_subscribers", null)).toBe(true);
    expect(announcementMatchesAudience("non_subscribers", "")).toBe(true);
    expect(announcementMatchesAudience("non_subscribers", "plan_1")).toBe(false);
  });
  it("unknown audience matches nobody", () => {
    expect(announcementMatchesAudience("everyone", null)).toBe(false);
    expect(announcementMatchesAudience(undefined, null)).toBe(false);
  });
});

describe("extractFcmToken", () => {
  it("extracts fcm:// tokens and rejects web endpoints", () => {
    expect(extractFcmToken("fcm://abc123")).toBe("abc123");
    expect(extractFcmToken("https://fcm.googleapis.com/fcm/send/x")).toBe(null);
    expect(extractFcmToken("fcm://")).toBe(null);
    expect(extractFcmToken(null)).toBe(null);
  });
});

describe("chunkTokens", () => {
  it("chunks at the FCM batch limit", () => {
    expect(chunkTokens([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkTokens([], 500)).toEqual([]);
  });
});
