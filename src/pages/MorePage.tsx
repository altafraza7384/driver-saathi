import { useI18n } from "@/lib/i18n";
import { 
  CreditCard, Target, Car, Bell, StickyNote, Shield, 
  Settings, ChevronRight, Sun, Moon, Info, HardDrive
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export default function MorePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [aboutOpen, setAboutOpen] = useState(false);
  const isDark = theme === "dark";

  const menuItems = [
    { labelKey: "more.debtEmi", icon: CreditCard, path: "/debts" },
    { labelKey: "more.goalsSavings", icon: Target, path: "/goals" },
    { labelKey: "more.carChecks", icon: Car, path: "/car-checks" },
    { labelKey: "more.reminders", icon: Bell, path: "/reminders" },
    { labelKey: "more.notes", icon: StickyNote, path: "/notes" },
    { labelKey: "more.emergencySos", icon: Shield, path: "/sos" },
    { labelKey: "more.dataBackup", icon: HardDrive, path: "/data-backup" },
    { labelKey: "more.settings", icon: Settings, path: "/settings" },
  ];

  return (
    <div className="space-y-5 p-4 pt-6">
      <h1 className="text-2xl font-bold">{t("nav.more")}</h1>
      <div className="space-y-1">
        {menuItems.map((item) => (
          <button key={item.path} onClick={() => navigate(item.path)}
            className="flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-muted">
            <div className="flex items-center gap-3">
              <item.icon className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">{t(item.labelKey)}</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
        <div className="flex w-full items-center justify-between rounded-lg p-3">
          <div className="flex items-center gap-3">
            {isDark ? <Moon className="h-5 w-5 text-muted-foreground" /> : <Sun className="h-5 w-5 text-muted-foreground" />}
            <span className="text-sm font-medium">{t("more.darkMode")}</span>
          </div>
          <Switch checked={isDark} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
        </div>
        <button onClick={() => setAboutOpen(true)}
          className="flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-muted">
          <div className="flex items-center gap-3">
            <Info className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">{t("more.about")}</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("more.about")}</DialogTitle>
            <DialogDescription>{t("more.aboutDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("more.appVersion")}</span>
              <span className="font-medium">1.0.0</span>
            </div>
            <div className="border-t pt-3 space-y-2">
              <h4 className="font-semibold">{t("more.privacyPolicy")}</h4>
              <p className="text-muted-foreground text-xs leading-relaxed">{t("more.privacyText")}</p>
            </div>
            <div className="border-t pt-3 space-y-2">
              <h4 className="font-semibold">{t("more.termsOfUse")}</h4>
              <p className="text-muted-foreground text-xs leading-relaxed">{t("more.termsText")}</p>
            </div>
            <p className="text-center text-xs text-muted-foreground pt-2">{t("more.copyright")}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}