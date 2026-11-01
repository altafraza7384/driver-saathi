import { describe, it, expect, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: {} }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: {} }));
vi.mock("@/lib/backend", () => ({ db: {} }));

import { foregroundNotificationId, openPushUrl } from "./native-push";

describe("foregroundNotificationId", () => {
  it("fits a Java int (Date.now() did not, so foreground pushes never showed)", () => {
    for (const now of [Date.now(), 1_762_037_880_000, 4_102_444_800_000, 0]) {
      const id = foregroundNotificationId(now);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(2_147_483_647);
    }
  });
});

describe("openPushUrl", () => {
  it("navigates to an in-app path", () => {
    const seen: string[] = [];
    const on = () => seen.push(window.location.pathname);
    window.addEventListener("popstate", on);
    openPushUrl("/reminders");
    window.removeEventListener("popstate", on);
    expect(seen).toEqual(["/reminders"]);
  });
  it("ignores external or junk urls", () => {
    const before = window.location.href;
    openPushUrl("https://evil.example");
    openPushUrl("//evil.example");
    openPushUrl(undefined);
    expect(window.location.href).toBe(before);
  });
});
