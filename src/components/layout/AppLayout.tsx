import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { initAdMob, showBannerAd } from "@/lib/admob";
import { requestAllPermissions } from "@/lib/native-permissions";
import { isNativeContext } from "@/lib/platform";

export function AppLayout() {
  usePushNotifications();

  useEffect(() => {
    // Request all native permissions on first launch
    requestAllPermissions();
    // Initialize AdMob
    initAdMob().then(() => showBannerAd());

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
    </div>
  );
}
