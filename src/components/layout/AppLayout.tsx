import { Outlet } from "react-router-dom";
import { BottomNav } from "./BottomNav";

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-lg pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
