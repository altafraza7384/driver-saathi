import { Capacitor } from "@capacitor/core";

/**
 * Request all necessary permissions on app first launch.
 * On native (Android), this triggers system permission dialogs.
 * On web, permissions are requested when needed.
 */
export async function requestAllPermissions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // 1. Push Notifications
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const pushPerm = await PushNotifications.checkPermissions();
    if (pushPerm.receive === "prompt") {
      await PushNotifications.requestPermissions();
    }
  } catch (e) {
    console.warn("Push permission request failed:", e);
  }

  // 2. Local Notifications
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const localPerm = await LocalNotifications.checkPermissions();
    if (localPerm.display === "prompt") {
      await LocalNotifications.requestPermissions();
    }
  } catch (e) {
    console.warn("Local notification permission failed:", e);
  }

  // 3. Speech Recognition (Microphone)
  try {
    const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
    const speechPerm = await SpeechRecognition.checkPermissions();
    if (speechPerm.speechRecognition === "prompt") {
      await SpeechRecognition.requestPermissions();
    }
  } catch (e) {
    console.warn("Speech recognition permission failed:", e);
  }
}
