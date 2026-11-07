import { Capacitor, registerPlugin } from "@capacitor/core";

export interface SpeechSilencePlugin {
  muteFor(options: { ms: number }): Promise<{ mutedMs: number }>;
}

const SpeechSilence = registerPlugin<SpeechSilencePlugin>("SpeechSilence");

export function isSpeechSilenceAvailable(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("SpeechSilence");
}

// Mute the recognizer beep for `ms`. Fire-and-forget and never throws:
// if the plugin is missing (web, old build) listening still works exactly
// as before, just with the beep.
export async function silenceBeep(ms: number): Promise<void> {
  if (!isSpeechSilenceAvailable()) return;
  try {
    await SpeechSilence.muteFor({ ms });
  } catch {
    // Beep stays; listening is unaffected.
  }
}
