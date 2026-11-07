import { Capacitor } from "@capacitor/core";
import { FirebaseAnalytics } from "@capacitor-firebase/analytics";

/**
 * Firebase Analytics (native only).
 *
 * The plugin is Android/iOS-only: its web implementation needs a
 * measurementId, which this app does not have in its web Firebase config.
 * So every call is gated on native platform and wrapped in try/catch —
 * analytics must never break the app or block a page open (performance rule).
 *
 * No personal data is ever sent: no user id, no phone, no email, no
 * amounts. Only screen names and generic event names.
 *
 * NOTE: Crashlytics was REMOVED 2026-11-07 — its Gradle plugin was never
 * applied, so the Crashlytics SDK had no build ID and crashed the app on
 * startup (v25). Do not re-add @capacitor-firebase/crashlytics without
 * applying the Crashlytics Gradle plugin first.
 */

function isAnalyticsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("FirebaseAnalytics");
}

/** Log the current screen (route) to Analytics. Fire-and-forget. */
export function logScreen(screenName: string): void {
  if (!isAnalyticsAvailable()) return;
  void FirebaseAnalytics.setCurrentScreen({ screenName }).catch(() => {
    // Analytics is best-effort; never surface a failure to the user.
  });
}

/** Log a generic event to Analytics. Fire-and-forget. No PII in params. */
export function logAppEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): void {
  if (!isAnalyticsAvailable()) return;
  void FirebaseAnalytics.logEvent({ name, params }).catch(() => {
    // Analytics is best-effort; never surface a failure to the user.
  });
}
