import { Capacitor } from "@capacitor/core";

let started = false;

/**
 * Make the Android status bar readable: LIGHT background with DARK icons
 * (time, network, battery), exactly like a normal navigation app, and keep
 * the app header below the status bar instead of under it.
 *
 * Why a plugin is needed, not CSS alone: the app is edge-to-edge
 * (viewport-fit=cover) and the layout already has `pt-safe`, but on
 * Android WebView `env(safe-area-inset-top)` is 0, so `pt-safe` adds
 * nothing and the "Good Morning" header slides under the status bar.
 * The white app background under a transparent status bar then leaves
 * the system's (light) status icons invisible on white. Only the native
 * StatusBar flag can switch the icons to dark, and only
 * `setOverlaysWebView(false)` makes Android inset the WebView below
 * the status bar. Web meta theme-color cannot do either in a Capacitor
 * WebView, so this plugin call is the minimal fix that reaches a
 * bundled APK through the repo (no android/ change is needed).
 *
 * Colours are deliberately NOT navy: the user-approved reference is a
 * light status bar with dark icons. Background is white (#ffffff).
 *
 * Safe on web and on older builds: the import is dynamic and every
 * failure is swallowed, so a build without the synced plugin behaves
 * exactly like today instead of crashing. v11 bundle verification must
 * still confirm the plugin IS present (see the marker in the report),
 * otherwise this is a no-op and the bug stays.
 */
export function initStatusBar(): void {
  if (started || !Capacitor.isNativePlatform()) return;
  started = true;
  import("@capacitor/status-bar")
    .then(async ({ StatusBar, Style }) => {
      if (!Capacitor.isPluginAvailable("StatusBar")) return;
      // Dark icons on a light background (Style.Dark = dark content).
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.show();
      if (Capacitor.getPlatform() === "android") {
        // Light status bar, never navy.
        await StatusBar.setBackgroundColor({ color: "#ffffff" });
        // WebView starts below the status bar: no page header can
        // slide under it, on any device / status-bar height.
        await StatusBar.setOverlaysWebView({ overlay: false });
      }
    })
    .catch((err) => {
      console.warn("Status bar setup failed (plugin missing?):", err);
    });
}
