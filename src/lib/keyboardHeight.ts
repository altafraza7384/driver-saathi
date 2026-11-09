import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

// Keyboard height for the chat input (Assistant / Finance AI).
//
// The app runs edge-to-edge, so Android's adjustResize never shrinks the
// window when the keyboard opens (see scripts/patch-android.mjs) and the
// fixed chat box stays behind the keyboard. Instead the Keyboard plugin
// reports the keyboard height and this module writes it to the --kb CSS
// variable on <html>; the chat screen (src/lib/chatScreen.ts) adds --kb to
// its bottom offset, so the input row moves above the keyboard exactly like
// a native chat app (Gemini/WhatsApp). The native ad slot re-measures on
// the ds-keyboard event (src/components/NativeAdSlot.tsx) because the chat
// moving up moves its slot too.
//
// Web: no-op (no plugin, no keyboard events); --kb stays unset and the
// chatScreen var() fallback (0px) applies.
export function isKeyboardAvailable(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("Keyboard");
}

function setKb(px: number): void {
  document.documentElement.style.setProperty("--kb", `${px}px`);
  // The native ad is positioned by its last reported rect; the chat moving
  // up moves its slot, so tell NativeAdSlot to re-measure now.
  window.dispatchEvent(new CustomEvent("ds-keyboard"));
}

// Call once at app start (main.tsx). Registers the listeners once; safe to
// call again (no duplicate listeners). Never throws.
let started = false;
export function initKeyboardHeight(): void {
  if (started || !isKeyboardAvailable()) return;
  started = true;
  try {
    // Will + Did both: on Android they fire almost together, and setting
    // the same height twice is harmless — so a missed Will event still
    // gets corrected by Did.
    void Keyboard.addListener("keyboardWillShow", (info) => setKb(info.keyboardHeight)).catch(() => undefined);
    void Keyboard.addListener("keyboardDidShow", (info) => setKb(info.keyboardHeight)).catch(() => undefined);
    void Keyboard.addListener("keyboardWillHide", () => setKb(0)).catch(() => undefined);
    void Keyboard.addListener("keyboardDidHide", () => setKb(0)).catch(() => undefined);
  } catch {
    // Keyboard events unavailable; the chat input stays where it is.
  }
}
