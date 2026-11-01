import { Capacitor } from "@capacitor/core";

let hidden = false;

/**
 * Hide the native launch splash (native only, at most once). index.html
 * normally hides it as soon as its loader is painted; this call after
 * React's first paint is the fallback. Hiding twice is harmless.
 */
export function hideNativeSplash(): void {
  if (hidden || !Capacitor.isNativePlatform()) return;
  hidden = true;
  import("@capacitor/splash-screen")
    .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 200 }))
    .catch(() => {
      // Plugin missing from an older native build: nothing to hide.
    });
}
