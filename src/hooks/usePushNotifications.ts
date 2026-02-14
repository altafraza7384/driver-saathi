import { useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
    if (
      !user ||
      !session ||
      subscribedRef.current ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      return;
    }

    try {
      // Register service worker
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Check if already subscribed
      const reg = registration as any;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        subscribedRef.current = true;
        return;
      }

      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.log("Notification permission denied");
        return;
      }

      // Get VAPID public key from edge function
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
        return;
      }

      const { publicKey } = await resp.json();
      if (!publicKey) return;

      // Subscribe to push
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        console.error("Invalid push subscription");
        return;
      }

      // Save to database
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
        { onConflict: "user_id,endpoint" }
      );

      if (error) {
        console.error("Failed to save push subscription:", error);
      } else {
        subscribedRef.current = true;
        console.log("Push notifications enabled!");
      }
    } catch (err) {
      console.error("Push subscription failed:", err);
    }
  }, [user, session]);

  useEffect(() => {
    // Delay subscription slightly to not block initial render
    const timer = setTimeout(() => {
      subscribe();
    }, 3000);
    return () => clearTimeout(timer);
  }, [subscribe]);
}
