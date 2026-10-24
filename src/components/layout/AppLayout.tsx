import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { initAdMob, showBannerAd } from "@/lib/admob";
import { requestAllPermissions } from "@/lib/native-permissions";
import { prefetchRoutes } from "@/lib/prefetchRoutes";
import { isNativeContext } from "@/lib/platform";

export function AppLayout() {
  usePushNotifications();

  useEffect(() => {
    // Defer native permission prompts + AdMob init until the browser is
    // idle (audit 2026-10-24): firing them on mount competed with the
    // Home page's own first data load. Home renders first; prompts
    // arrive a few seconds later instead of barraging on first paint.
    const defer = (fn: () => void) => {
      const ric = (window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
      }).requestIdleCallback;
      if (typeof ric === "function") ric(fn, { timeout: 3000 });
      else setTimeout(fn, 2000);
    };
    defer(() => { requestAllPermissions(); });
    defer(() => { initAdMob().then(() => showBannerAd()); });
    // Warm the cache for daily-use pages while idle, so later taps open
    // instantly instead of downloading their chunk on the spot.
    prefetchRoutes();

    // Add native-app class to body for native-specific CSS
    if (isNativeContext()) {
      document.body.classList.add("native-app");
    }

    return () => {
      document.body.classList.remove("native-app");
    };
  }, []);

  return (
    <div className="min-h-screen bg-background pt-safe">
      <main className="mx-auto w-full max-w-md px-0 pb-28 pt-0 sm:max-w-lg">
        <Outlet />
      </main>
      <BottomNav />
      <UpdatePrompt />
    </div>
  );
}
