import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { supabase } from "@/integrations/supabase/client";

/**
 * Native push notifications using FCM (Firebase Cloud Messaging) on Android.
 * Falls back to web push (VAPID) on non-native platforms.
 */

export async function registerNativePush(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // Request permission
  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== "granted") {
    console.warn("Push notification permission denied");
    return;
  }

  // Register only after listeners are installed.

  // Listen for the FCM token
  await PushNotifications.addListener("registration", async (token) => {
    // Never log FCM registration tokens.
    // Store FCM token in push_subscriptions (reuse the table)
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: `fcm://${token.value}`,
        p256dh: "native",
        auth: "native",
      },
      { onConflict: "user_id,endpoint" }
    );
  });

  await PushNotifications.addListener("registrationError", (err) => {
    console.error("FCM registration error:", err);
  });

  // Handle incoming notifications when app is open
  await PushNotifications.addListener("pushNotificationReceived", async (notification) => {
    // Show as local notification so user sees it
    await LocalNotifications.schedule({
      notifications: [
        {
          title: notification.title || "Driver Saathi",
          body: notification.body || "",
          id: Date.now(),
          extra: notification.data,
        },
      ],
    });
  });

  // Handle notification tap
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const url = action.notification.data?.url;
    if (url && typeof window !== "undefined") {
      if (url.startsWith("/") && !url.startsWith("//")) window.location.assign(url);
    }
  });
  await PushNotifications.register();
}

export async function requestLocalNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  const result = await LocalNotifications.requestPermissions();
  return result.display === "granted";
}
