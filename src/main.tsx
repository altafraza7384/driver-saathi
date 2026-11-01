import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";

import App from "./App.tsx";
import { AppErrorBoundary, reloadOnceForChunkError } from "./components/AppErrorBoundary";
import { hideNativeSplash } from "./lib/splash";
import "./index.css";

// Register service worker for offline support & push notifications.
// Web/PWA only: the native app bundles its files and uses FCM for push, and
// a service worker there only adds work (and a cache layer) to cold start.
if ("serviceWorker" in navigator) {
  if (!Capacitor.isNativePlatform()) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("SW registration failed:", err);
      });
    });
  } else {
    // Drop a worker registered by an earlier native build.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
  }
}

// Vite fires this when a lazy page's code file fails to download; one
// automatic reload recovers instead of showing the error screen.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceForChunkError()) event.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

(window as Window & { __dsMounted?: boolean }).__dsMounted = true;

// Release the native splash once the first frame with the app is on screen.
requestAnimationFrame(() => requestAnimationFrame(hideNativeSplash));
