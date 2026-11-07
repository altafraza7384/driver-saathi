import { Capacitor } from "@capacitor/core";
import { FirebaseAnalytics } from "@capacitor-firebase/analytics";
import { FirebaseCrashlytics } from "@capacitor-firebase/crashlytics";

/**
 * Firebase Analytics + Crashlytics (native only).
 *
 * Both plugins are Android/iOS-only: their web implementations either
 * throw ("not implemented") or need a measurementId, which this app
 * does not have in its web Firebase config. So every call is gated on
 * native platform and wrapped in try/catch — analytics must never
 * break the app or block a page open (performance rule).
 *
 * No personal data is ever sent: no user id, no phone, no email, no
 * amounts. Only screen names and generic event names.
 */

function isAnalyticsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("FirebaseAnalytics");
}

function isCrashlyticsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("FirebaseCrashlytics");
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

/** Record a non-fatal error (e.g. a React render error) to Crashlytics. Fire-and-forget. */
export function recordNonFatal(message: string): void {
  if (!isCrashlyticsAvailable()) return;
  void FirebaseCrashlytics.recordException({ message }).catch(() => {
    // Crash reporting is best-effort; never surface a failure to the user.
  });
}
