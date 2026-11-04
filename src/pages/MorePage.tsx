import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import {
  CreditCard, Target, Car, Bell, StickyNote, Shield,
  Settings, ChevronRight, Info, HardDrive, Wallet
} from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function MorePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Admin entry point (audit 2026-10-24): /admin was reachable only by
  // typing the URL. Show the row only to admins (same has_role check
  // as AdminLayout); the panel itself still role-gates.
  const { data: isAdmin } = useQuery({
    queryKey: ["is_admin", user?.id],
    queryFn: async () => {
      const { data, error } = await db.rpc("has_role", { _user_id: user!.id, _role: "admin" });
      if (error) return false;
      return data as boolean;
    },
    enabled: !!user,
  });
  
  const menuGroups = [
    {
      headingKey: "more.groupMoney",
      items: [
        { labelKey: "more.debtEmi", icon: CreditCard, path: "/debts" },
        { labelKey: "more.budgets", icon: Wallet, path: "/budgets" },
        { labelKey: "more.goalsSavings", icon: Target, path: "/goals" },
        { labelKey: "plans.title", icon: CreditCard, path: "/plans" },
      ],
    },
    {
      headingKey: "more.groupVehicleDaily",
      items: [
        { labelKey: "more.carChecks", icon: Car, path: "/car-checks" },
        { labelKey: "more.reminders", icon: Bell, path: "/reminders" },
        { labelKey: "more.notes", icon: StickyNote, path: "/notes" },
        { labelKey: "more.emergencySos", icon: Shield, path: "/sos" },
      ],
    },
    {
      headingKey: "more.groupHelpAccount",
      items: [
        { labelKey: "more.dataBackup", icon: HardDrive, path: "/data-backup" },
        { labelKey: "more.settings", icon: Settings, path: "/settings" },
        { labelKey: "more.supportAbout", icon: Info, path: "/support" },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md px-4 pt-6 pb-3 border-b border-border/50">
        <h1 className="text-2xl font-bold">{t("nav.more")}</h1>
      </div>
      <div className="px-4 space-y-5">
      <div className="space-y-1">
        {menuGroups.map((group) => (
          <div key={group.headingKey} className="space-y-1">
            <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(group.headingKey)}</p>
            {group.items.map((item) => (
              <button key={item.path} onClick={() => navigate(item.path)}
                className="flex w-full items-center justify-between rounded-xl p-4 text-left transition-colors hover:bg-muted active:bg-muted/80">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <item.icon className="h-5 w-5 text-foreground" />
                  </div>
                  <span className="text-base font-bold">{t(item.labelKey)}</span>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            ))}
          </div>
        ))}

        {isAdmin && (
          <button onClick={() => navigate("/admin")}
            className="flex w-full items-center justify-between rounded-xl p-4 text-left transition-colors hover:bg-muted active:bg-muted/80">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Shield className="h-5 w-5 text-foreground" />
              </div>
              <span className="text-base font-bold">{t("more.adminPanel")}</span>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        )}

      </div>
    </div>
  );
}
