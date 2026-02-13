import { Home, ArrowLeftRight, Heart, Bot, Menu } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", icon: Home, labelKey: "nav.home" },
  { path: "/transactions", icon: ArrowLeftRight, labelKey: "nav.transactions" },
  { path: "/health", icon: Heart, labelKey: "nav.health" },
  { path: "/assistant", icon: Bot, labelKey: "nav.assistant" },
  { path: "/more", icon: Menu, labelKey: "nav.more" },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-md items-center justify-around py-1 pb-safe sm:max-w-lg">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-2 text-xs transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon
                className={cn("h-5 w-5", isActive && "stroke-[2.5px]")}
              />
              <span className={cn("font-medium", isActive && "font-semibold")}>
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
