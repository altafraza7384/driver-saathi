import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-md px-0 pb-20 sm:max-w-lg">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
