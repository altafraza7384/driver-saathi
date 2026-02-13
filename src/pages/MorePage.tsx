import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { 
  CreditCard, Target, Car, Bell, StickyNote, Shield, 
  Settings, ChevronRight
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

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
      </div>
    </div>
  );
}
