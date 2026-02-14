import { useI18n } from "@/lib/i18n";
import { 
  CreditCard, Target, Car, Bell, StickyNote, Shield, 
  Settings, ChevronRight, Sun, Moon, Info
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const menuItems = [
  { label: "Debt & EMI", icon: CreditCard, path: "/debts" },
  { label: "Goals & Savings", icon: Target, path: "/goals" },
  { label: "Car Checks", icon: Car, path: "/car-checks" },
  { label: "Reminders", icon: Bell, path: "/reminders" },
  { label: "Notes", icon: StickyNote, path: "/notes" },
  { label: "Emergency SOS", icon: Shield, path: "/sos" },
  { label: "Settings", icon: Settings, path: "/settings" },
];

export default function MorePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [aboutOpen, setAboutOpen] = useState(false);

  const isDark = theme === "dark";

  return (
    <div className="space-y-5 p-4 pt-6">
      <h1 className="text-2xl font-bold">{t("nav.more")}</h1>

      <div className="space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-muted"
          >
            <div className="flex items-center gap-3">
              <item.icon className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}

        {/* Theme Toggle */}
        <div className="flex w-full items-center justify-between rounded-lg p-3">
          <div className="flex items-center gap-3">
            {isDark ? (
              <Moon className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Sun className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">Dark Mode</span>
          </div>
          <Switch
            checked={isDark}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          />
        </div>

        {/* About */}
        <button
          onClick={() => setAboutOpen(true)}
          className="flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-muted"
        >
          <div className="flex items-center gap-3">
            <Info className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">About</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* About Dialog */}
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>About</DialogTitle>
            <DialogDescription>App information, privacy policy and terms of use.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">App Version</span>
              <span className="font-medium">1.0.0</span>
            </div>
            <div className="border-t pt-3 space-y-2">
              <h4 className="font-semibold">Privacy Policy</h4>
              <p className="text-muted-foreground text-xs leading-relaxed">
                We respect your privacy. Your data is stored securely and is only accessible by you. We do not share your personal or financial information with third parties. All data transmission is encrypted.
              </p>
            </div>
            <div className="border-t pt-3 space-y-2">
              <h4 className="font-semibold">Terms of Use</h4>
              <p className="text-muted-foreground text-xs leading-relaxed">
                By using this app, you agree to use it responsibly. This app is designed to help drivers manage their finances and daily activities. We are not liable for financial decisions made based on app data.
              </p>
            </div>
            <p className="text-center text-xs text-muted-foreground pt-2">
              © 2026 Driver Buddy. All rights reserved.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
