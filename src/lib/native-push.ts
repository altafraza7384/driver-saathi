import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { db, BACKEND } from "@/lib/backend";

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

type PushGuard = () => boolean;
type SessionIdentity = object | string;

let generation = 0;
let sessionIdentity: SessionIdentity | null = null;
let sessionUserId: string | null = null;
const stoppedSessions = new Set<SessionIdentity>();
const pendingRegistrations = new Set<Promise<unknown>>();
let cleanup: Promise<void> | null = null;
let listenersReady: Promise<void> | null = null;
let nativeSession: { userId: string; isCurrent: PushGuard } | null = null;
let nativeEndpoint: { userId: string; endpoint: string } | null = null;

async function pushIdentity(userId: string): Promise<{ identity: SessionIdentity; isCurrent: PushGuard } | null> {
  if (BACKEND === "firebase") {
    // Dynamic import keeps importing the pure notification helpers independent
    // of Firebase initialization, and avoids an adapter/backend import cycle.
    const { firebaseAuth } = await import("@/integrations/firebase/client");
    const user = firebaseAuth.currentUser;
    if (!user || user.uid !== userId) return null;
    return { identity: user, isCurrent: () => firebaseAuth.currentUser === user };
  }
  const { data } = await db.auth.getSession();
  const session = data.session;
  if (session?.user.id !== userId || !session.access_token) return null;
  return { identity: session.access_token, isCurrent: () => true };
}

/** Registration and token saves must finish before logout removes a binding. */
export async function withPushRegistration<T>(userId: string, work: (isCurrent: PushGuard) => Promise<T>): Promise<T | undefined> {
  // A new account waits until the previous device binding has been revoked.
  if (cleanup) await cleanup;
  const session = await pushIdentity(userId);
  if (!session || cleanup || stoppedSessions.has(session.identity) || !session.isCurrent()) return;
  if (sessionIdentity !== session.identity) {
    sessionIdentity = session.identity;
    sessionUserId = userId;
    generation += 1;
  }
  const version = generation;
  const isCurrent = () => version === generation && sessionIdentity === session.identity
    && !stoppedSessions.has(session.identity) && session.isCurrent();
  const job = Promise.resolve().then(() => isCurrent() ? work(isCurrent) : undefined);
  pendingRegistrations.add(job);
  try { return await job; }
  finally { pendingRegistrations.delete(job); }
}

/** Revoke this device while its user's authenticated database access exists. */
export function unregisterPush(userId: string): Promise<void> {
  if (cleanup) return cleanup;
  generation += 1;
  if (sessionIdentity && sessionUserId === userId) stoppedSessions.add(sessionIdentity);
  sessionIdentity = null;
  sessionUserId = null;
  nativeSession = null;
  const operation = (async () => {
    // Cover logout before this app instance has attempted push registration.
    const session = await pushIdentity(userId);
    if (session) stoppedSessions.add(session.identity);
    await Promise.allSettled([...pendingRegistrations]);

    let endpoint = nativeEndpoint?.userId === userId ? nativeEndpoint.endpoint : null;
    let subscription: PushSubscription | null = null;
    if (!Capacitor.isNativePlatform() && "serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      subscription = await registration?.pushManager?.getSubscription() ?? null;
      endpoint = subscription?.endpoint ?? null;
    }
    const removeBinding = async (): Promise<boolean> => {
      if (!endpoint || !session?.isCurrent()) return false;
      const { error } = await db.from("push_subscriptions").delete()
        .eq("user_id", userId).eq("endpoint", endpoint);
      if (error) throw error;
      return true;
    };
    const revokeTransport = async (): Promise<boolean> => {
      if (Capacitor.isNativePlatform()) await PushNotifications.unregister();
      else if (subscription && !await subscription.unsubscribe()) throw new Error("Push unsubscribe failed");
      return true;
    };
    // A denied/offline database delete must not skip local token revocation.
    const [binding, transport] = await Promise.allSettled([removeBinding(), revokeTransport()]);
    if (binding.status === "rejected") console.warn("Removing push binding failed");
    if (transport.status === "rejected") console.warn("Revoking push transport failed");
    if (!(binding.status === "fulfilled" && binding.value)
      && !(transport.status === "fulfilled" && transport.value)) {
      throw new Error("Could not disable this device's push notifications. Please retry sign out.");
    }
    nativeEndpoint = null;
  })();
  cleanup = operation;
  void operation.finally(() => { if (cleanup === operation) cleanup = null; }).catch(() => undefined);
  return operation;
}

function ensureNativeListeners(): Promise<void> {
  if (listenersReady) return listenersReady;
  const handles: Array<{ remove: () => Promise<void> }> = [];
  listenersReady = (async () => {
    try {
      handles.push(await PushNotifications.addListener("registration", (token) => {
        const target = nativeSession;
        if (!target?.isCurrent()) return;
        const endpoint = `fcm://${token.value}`;
        nativeEndpoint = { userId: target.userId, endpoint };
        void withPushRegistration(target.userId, async (isCurrent) => {
          if (!isCurrent() || !target.isCurrent()) return;
          const { error } = await db.from("push_subscriptions").upsert({
            user_id: target.userId, endpoint, p256dh: "native", auth: "native",
          }, { onConflict: "user_id,endpoint" });
          if (error) throw error;
        }).catch(() => console.error("Saving FCM token failed"));
      }));
      handles.push(await PushNotifications.addListener("registrationError", () => {
        console.error("FCM registration failed");
      }));
      handles.push(await PushNotifications.addListener("pushNotificationReceived", async (notification) => {
        if (!nativeSession?.isCurrent()) return;
        try {
          await LocalNotifications.schedule({
            notifications: [{
              title: notification.title || "Driver Saathi", body: notification.body || "",
              id: foregroundNotificationId(), channelId: PUSH_CHANNEL_ID, extra: notification.data,
            }],
          });
        } catch {
          console.error("Showing foreground push failed");
        }
      }));
      handles.push(await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        if (nativeSession?.isCurrent()) openPushUrl(action.notification.data?.url);
      }));
      handles.push(await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
        if (nativeSession?.isCurrent()) openPushUrl(action.notification.extra?.url);
      }));
    } catch (error) {
      await Promise.allSettled(handles.map((handle) => handle.remove()));
      listenersReady = null;
      throw error;
    }
  })();
  return listenersReady;
}

export async function registerNativePush(userId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await withPushRegistration(userId, async (isCurrent) => {
    const permission = await PushNotifications.requestPermissions();
    if (!isCurrent() || permission.receive !== "granted") return;
    try {
      await PushNotifications.createChannel({
        id: PUSH_CHANNEL_ID, name: "Reminders",
        description: "Reminders, EMI, bills and document expiry",
        importance: 5, visibility: 1, vibration: true,
      });
    } catch { console.warn("Push channel create failed"); }
    if (!isCurrent()) return;
    await ensureNativeListeners();
    if (!isCurrent()) return;
    nativeSession = { userId, isCurrent };
    await PushNotifications.register();
  });
}

export async function requestLocalNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  const result = await LocalNotifications.requestPermissions();
  return result.display === "granted";
}
