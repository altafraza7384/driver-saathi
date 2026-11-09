import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { db, BACKEND } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { registerNativePush, unregisterPush, withPushRegistration } from "@/lib/native-push";

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
  const userId = user?.id ?? null;
  const subscribedRef = useRef<string | null>(null);
  const previousUserRef = useRef<string | null>(null);
  const latestUserRef = useRef(userId);
  const generationRef = useRef(0);
  latestUserRef.current = userId;

  useEffect(() => {
    const previousUser = previousUserRef.current;
    previousUserRef.current = userId;
    if (subscribedRef.current !== userId) subscribedRef.current = null;
    const version = ++generationRef.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => !cancelled && generationRef.current === version && latestUserRef.current === userId;

    const registerOnce = async (): Promise<boolean | undefined> => {
      if (!userId || !isCurrent()) return false;
      if (Capacitor.isNativePlatform()) {
        // Native registration tracks its own asynchronous jobs and token saves.
        await registerNativePush(userId);
        return isCurrent();
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return false;
      return withPushRegistration(userId, async (sessionCurrent) => {
        const current = () => isCurrent() && sessionCurrent();
        const registration = await navigator.serviceWorker.register("/sw.js");
        if (!current()) return false;
        await navigator.serviceWorker.ready;
        if (!current()) return false;
        let subscription = await registration.pushManager.getSubscription();
        if (!current()) return false;
        // An existing browser subscription still needs a binding for THIS
        // account. It does not need another permission prompt or VAPID key.
        if (!subscription) {
          const permission = await Notification.requestPermission();
          if (!current() || permission !== "granted") return false;
          let publicKey: string | undefined;
          if (BACKEND === "firebase") {
            publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
            if (!publicKey) {
              console.warn("VITE_VAPID_PUBLIC_KEY is not set; skipping web push subscription.");
              return false;
            }
          } else {
            const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notifications`, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
            });
            if (!current()) return false;
            if (!response.ok) throw new Error(`Failed to get VAPID key: ${response.status}`);
            const data = await response.json();
            if (!current()) return false;
            publicKey = data.publicKey;
            if (!publicKey) return false;
          }
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
          if (!current()) return false;
        }
        const subJson = subscription.toJSON();
        if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) return false;
        const { error } = await db.from("push_subscriptions").upsert({
          user_id: userId, endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh, auth: subJson.keys.auth,
        }, { onConflict: "user_id,endpoint" });
        if (error) throw error;
        return current();
      });
    };

    const subscribe = async () => {
      // Retry transient failures, but never retry an old account's operation.
      for (let attempt = 0; attempt < 3 && isCurrent(); attempt += 1) {
        try {
          const registered = await registerOnce();
          if (registered && isCurrent()) subscribedRef.current = userId;
          return;
        } catch {
          console.error("Push registration failed");
          if (attempt === 2 || !isCurrent()) return;
          await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        }
      }
    };
    const prepare = async () => {
      if (previousUser && previousUser !== userId) {
        // A direct account switch may have already removed old DB access;
        // unregisterPush still revokes the old device transport in that case.
        try { await unregisterPush(previousUser); }
        catch { console.error("Previous account push cleanup failed"); return; }
      }
      if (!isCurrent() || !userId || !session || subscribedRef.current === userId) return;
      timer = setTimeout(() => { void subscribe(); }, 3000);
    };
    void prepare();
    // Ordinary page unmount/app close must keep background push enabled.
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [userId, session?.access_token]);
}
