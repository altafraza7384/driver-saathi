import { Home, ArrowLeftRight, Bot, Menu } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", icon: Home, labelKey: "nav.home" },
  { path: "/transactions", icon: ArrowLeftRight, labelKey: "nav.transactions" },
  { path: "/assistant", icon: Bot, labelKey: "nav.assistant" },
  { path: "/more", icon: Menu, labelKey: "nav.more" },
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t-2 bg-card/98 backdrop-blur-md safe-bottom shadow-lg">
      <div className="mx-auto flex w-full max-w-md items-stretch justify-around sm:max-w-lg">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 min-h-[68px] py-2 transition-colors relative",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-1 rounded-b-full bg-primary" />
              )}
              <item.icon
                className={cn("h-7 w-7 shrink-0", isActive ? "stroke-[2.5px]" : "stroke-[1.8px]")}
              />
              <span className={cn(
                "truncate max-w-full px-1 text-sm leading-tight",
                isActive ? "font-extrabold" : "font-bold"
              )}>
                {t(item.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
