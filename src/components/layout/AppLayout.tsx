import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { initAdMob, showBannerAd } from "@/lib/admob";

export function AppLayout() {
  usePushNotifications();

  useEffect(() => {
    initAdMob().then(() => showBannerAd());
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-md px-0 pb-20 sm:max-w-lg">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
