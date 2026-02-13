import { Plus, Minus, Car, StickyNote, Bell, ChevronRight, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatINR } from "@/lib/currency";

function getGreetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "home.morning";
  if (hour < 17) return "home.afternoon";
  return "home.evening";
}

const quickActions = [
  { labelKey: "home.addIncome", icon: Plus, path: "/transactions/add?type=income", color: "bg-success text-success-foreground" },
  { labelKey: "home.addExpense", icon: Minus, path: "/transactions/add?type=expense", color: "bg-destructive text-destructive-foreground" },
  { labelKey: "home.carCheck", icon: Car, path: "/car-checks", color: "bg-warning text-warning-foreground" },
  { labelKey: "home.notes", icon: StickyNote, path: "/notes", color: "bg-primary text-primary-foreground" },
];

const mockTransactions = [
  { id: 1, type: "income" as const, amount: 1250, label: "Uber Ride", time: "2h ago" },
  { id: 2, type: "expense" as const, amount: 500, label: "Fuel - HP", time: "4h ago" },
  { id: 3, type: "income" as const, amount: 800, label: "Ola Ride", time: "5h ago" },
];

export default function HomePage() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="space-y-5 p-4 pt-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <p className="text-sm text-muted-foreground">
            {t("home.greeting")} {t(getGreetingKey())} 👋
          </p>
          <h1 className="text-2xl font-bold">{t("common.driver")}</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => navigate("/reminders")}
        >
          <Bell className="h-5 w-5" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
            3
          </span>
        </Button>
      </motion.div>

      {/* Today's Earnings Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg">
          <CardContent className="p-5">
            <p className="text-sm font-medium opacity-90">{t("home.todayEarnings")}</p>
            <p className="mt-1 text-3xl font-extrabold tracking-tight">
              {formatINR(2050)}
            </p>
            <div className="mt-3 flex gap-4 text-sm opacity-80">
              <span>Income: {formatINR(2050)}</span>
              <span>Expense: {formatINR(500)}</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* SOS Button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        <Button
          variant="destructive"
          className="w-full gap-2 py-3 text-base font-bold shadow-md"
          onClick={() => navigate("/sos")}
        >
          <AlertTriangle className="h-5 w-5" />
          Emergency SOS
        </Button>
      </motion.div>

      {/* Quick Actions */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <h2 className="mb-3 text-base font-semibold">{t("home.quickActions")}</h2>
        <div className="grid grid-cols-4 gap-3">
          {quickActions.map((action) => (
            <button
              key={action.labelKey}
              onClick={() => navigate(action.path)}
              className="flex flex-col items-center gap-1.5"
            >
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${action.color} shadow-sm`}>
                <action.icon className="h-5 w-5" />
              </div>
              <span className="text-center text-[11px] font-medium leading-tight text-muted-foreground">
                {t(action.labelKey)}
              </span>
            </button>
          ))}
        </div>
      </motion.section>

      {/* Pending Reminders */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-warning" />
              <div>
                <p className="text-sm font-semibold">{t("home.pendingReminders")}</p>
                <p className="text-xs text-muted-foreground">Insurance, PUC, EMI</p>
              </div>
            </div>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-warning text-sm font-bold text-warning-foreground">
              3
            </span>
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Transactions */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("home.recentTransactions")}</h2>
          <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("/transactions")}>
            {t("home.viewAll")} <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
        <div className="space-y-2">
          {mockTransactions.map((tx) => (
            <Card key={tx.id} className="border-0 shadow-sm">
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      tx.type === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {tx.type === "income" ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{tx.label}</p>
                    <p className="text-xs text-muted-foreground">{tx.time}</p>
                  </div>
                </div>
                <span
                  className={`text-sm font-bold ${
                    tx.type === "income" ? "text-success" : "text-destructive"
                  }`}
                >
                  {tx.type === "income" ? "+" : "-"}{formatINR(tx.amount)}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.section>
    </div>
  );
}
