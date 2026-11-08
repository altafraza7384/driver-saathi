import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { db } from "@/lib/backend";

/**
 * Native push notifications using FCM (Firebase Cloud Messaging) on Android.
 * Falls back to web push (VAPID) on non-native platforms.
 */

/** Android channel the server's reminder pushes target (high importance:
 *  heads-up banner + sound). Must match channelId in sendNotifications. */
export const PUSH_CHANNEL_ID = "reminders";

/** Local-notification ids are Java ints on Android (32-bit). Date.now()
 *  (~1.7e12) is rejected with "The identifier should be a Java int", which
 *  is why a push that arrived while the app was open never showed. */
export function foregroundNotificationId(now: number = Date.now()): number {
  return Math.floor(now % 2_000_000_000) + 1;
}

/** Open an in-app path from a notification tap. The app uses BrowserRouter,
 *  so setting location.hash (the old code) never changed the page. Only
 *  same-app paths ("/reminders") are followed. */
export function openPushUrl(url: unknown): void {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return;
  if (typeof window === "undefined") return;
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// Push listeners are added exactly once per app lifetime: registerNativePush
// is retried on transient failure (usePushNotifications), and re-adding
// them would fire every foreground push twice (two identical local
// notifications, two openPushUrl calls on tap).
let listenersAdded = false;

export async function registerNativePush(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // Request permission
  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== "granted") {
    console.warn("Push notification permission denied");
    return;
  }

  try {
    await PushNotifications.createChannel({
      id: PUSH_CHANNEL_ID,
      name: "Reminders",
      description: "Reminders, EMI, bills and document expiry",
      importance: 5,
      visibility: 1,
      vibration: true,
    });
  } catch (err) {
    console.warn("Push channel create failed:", err);
  }

  // Listeners first, then register, so the token event is never missed.
  // Added once only (see listenersAdded above): a retry must not add a
  // second set, or every foreground push would show twice.
  if (!listenersAdded) {
    await PushNotifications.addListener("registration", async (token) => {
      // Store FCM token in push_subscriptions (reuse the table)
      const { error } = await db.from("push_subscriptions").upsert(
        {
          user_id: userId,
          endpoint: `fcm://${token.value}`,
          p256dh: "native",
          auth: "native",
        },
        { onConflict: "user_id,endpoint" }
      );
      if (error) console.error("Saving FCM token failed:", error);
    });

    await PushNotifications.addListener("registrationError", (err) => {
      console.error("FCM registration error:", err);
    });

    // Android does not show a push itself while the app is open: show it
    // as a local notification on the same channel.
    await PushNotifications.addListener("pushNotificationReceived", async (notification) => {
      try {
        await LocalNotifications.schedule({
          notifications: [
            {
              title: notification.title || "Driver Saathi",
              body: notification.body || "",
              id: foregroundNotificationId(),
              channelId: PUSH_CHANNEL_ID,
              extra: notification.data,
            },
          ],
        });
      } catch (err) {
        console.error("Showing foreground push failed:", err);
      }
    });

    // Notification tap (closed-app push, or the foreground copy above).
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      openPushUrl(action.notification.data?.url);
    });
    await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      openPushUrl(action.notification.extra?.url);
    });
    listenersAdded = true;
  }

  // Register with FCM, which fires the registration listener above.
  await PushNotifications.register();
}
