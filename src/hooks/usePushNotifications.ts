import { useEffect, useCallback, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { db, BACKEND } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { registerNativePush } from "@/lib/native-push";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const { user, session } = useAuth();
  const subscribedRef = useRef(false);

  const subscribe = useCallback(async () => {
    if (!user || !session || subscribedRef.current) return;

    // Register once. Returns true when push is set up (or already set up),
    // false when it must NOT be retried (permission denied, missing VAPID
    // key, unsupported browser). Throws on a transient failure so the
    // caller can retry it. subscribedRef is set only on success.
    const registerOnce = async (): Promise<boolean> => {
      // Native: use FCM via Capacitor
      if (Capacitor.isNativePlatform()) {
        await registerNativePush(user.id);
        subscribedRef.current = true;
        return true;
      }

      // Web: use VAPID web push
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        return false;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const reg = registration as any;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        subscribedRef.current = true;
        return true;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.log("Notification permission denied");
        return false;
      }

      let publicKey: string | undefined;
      if (BACKEND === "firebase") {
        publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!publicKey) {
          console.warn("VITE_VAPID_PUBLIC_KEY is not set; skipping web push subscription.");
          return false;
        }
      } else {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notifications`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );

        if (!resp.ok) {
          console.error("Failed to get VAPID key:", resp.status);
          return false;
        }

        const data = await resp.json();
        publicKey = data.publicKey;
        if (!publicKey) return false;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        console.error("Invalid push subscription");
        return false;
      }

      const { error } = await db.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
        { onConflict: "user_id,endpoint" }
      );

      if (error) {
        throw error;
      }
      subscribedRef.current = true;
      console.log("Push notifications enabled!");
      return true;
    };

    // A failed registration at startup (phone just woke up, network not
    // ready yet) must not mean no pushes until the next app restart. Retry
    // up to 3 times with backoff.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await registerOnce();
        return;
      } catch (err) {
        console.error("Push registration failed:", err);
        if (attempt === 2) return;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }, [user, session]);

  useEffect(() => {
    const timer = setTimeout(() => {
      subscribe();
    }, 3000);
    return () => clearTimeout(timer);
  }, [subscribe]);
}
