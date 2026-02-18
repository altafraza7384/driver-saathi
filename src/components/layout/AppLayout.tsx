import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { initAdMob, showBannerAd } from "@/lib/admob";
import { requestAllPermissions } from "@/lib/native-permissions";

export function AppLayout() {
  usePushNotifications();

  useEffect(() => {
    // Request all native permissions on first launch
    requestAllPermissions();
    // Initialize AdMob
    initAdMob().then(() => showBannerAd());
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-md px-0 pb-24 sm:max-w-lg">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
