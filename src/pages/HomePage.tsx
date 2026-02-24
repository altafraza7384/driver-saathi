import { Plus, Minus, Car, StickyNote, ChevronRight, Target, CreditCard, Heart, AlertTriangle } from "lucide-react";
import { AdBanner } from "@/components/AdBanner";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n";
import { formatINR } from "@/lib/currency";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NotificationBell } from "@/components/NotificationBell";

function getGreetingKey(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "home.morning";
  if (hour < 17) return "home.afternoon";
  return "home.evening";
}

const quickActions = [
  { labelKey: "home.addTransaction", icon: Plus, path: "/transactions/add", color: "bg-primary text-primary-foreground" },
  { labelKey: "home.carCheck", icon: Car, path: "/car-checks", color: "bg-warning text-warning-foreground" },
  { labelKey: "home.notes", icon: StickyNote, path: "/notes", color: "bg-success text-success-foreground" },
  { labelKey: "nav.health", icon: Heart, path: "/health", color: "bg-destructive text-destructive-foreground" },
  { labelKey: "nav.sos", icon: AlertTriangle, path: "/sos", color: "bg-primary text-primary-foreground" },
];

export default function HomePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = new Date().toISOString().split("T")[0];

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name").eq("user_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: todayTx = [] } = useQuery({
    queryKey: ["transactions_today"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("*").eq("transaction_date", today).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: debts = [] } = useQuery({
    queryKey: ["debts_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("debts").select("*").eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["goals_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("goals").select("*").eq("is_completed", false);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const todayIncome = todayTx.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const todayExpense = todayTx.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const driverName = profile?.full_name || t("common.driver");

  return (
    <div className="space-y-5">
      {/* Sticky Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md px-4 pt-6 pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{t("home.greeting")} {t(getGreetingKey())} 👋</p>
            <h1 className="text-2xl font-bold">{driverName}</h1>
          </div>
          <NotificationBell />
        </div>
      </div>

      <div className="space-y-5 p-4 pt-0">

      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg">
          <CardContent className="p-5">
            <p className="text-sm font-medium opacity-90">{t("home.todayEarnings")}</p>
            <p className="mt-1 text-3xl font-extrabold tracking-tight">{formatINR(todayIncome - todayExpense)}</p>
            <div className="mt-3 flex gap-4 text-sm opacity-80">
              <span>{t("home.income")}: {formatINR(todayIncome)}</span>
              <span>{t("home.expense")}: {formatINR(todayExpense)}</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardContent className="p-2">
            <AdBanner className="max-h-[60px]" />
          </CardContent>
        </Card>
      </motion.div>

      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <h2 className="mb-3 text-base font-bold">{t("home.quickActions")}</h2>
        <div className="grid grid-cols-5 gap-3 w-full">
          {quickActions.map((action) => (
            <button key={action.labelKey} onClick={() => navigate(action.path)} className="flex flex-col items-center gap-2 w-full active:scale-95 transition-transform">
              <div className={`flex w-full aspect-square items-center justify-center rounded-2xl ${action.color} shadow-md`}>
                <action.icon className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
              <span className="text-center text-[11px] sm:text-xs font-extrabold leading-tight text-muted-foreground w-full truncate">{t(action.labelKey)}</span>
            </button>
          ))}
        </div>
      </motion.section>

      {debts.length > 0 && (
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t("home.debtProgress")}</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("/debts")}>
              {t("home.viewAll")} <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
          <div className="space-y-2">
            {debts.slice(0, 3).map((debt) => {
              const paidPercent = debt.principal > 0 ? Math.min((Number(debt.total_paid) / Number(debt.principal)) * 100, 100) : 0;
              const remaining = Math.max(Number(debt.principal) - Number(debt.total_paid), 0);
              return (
                <Card key={debt.id} className="border-0 shadow-sm">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{debt.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{Math.round(paidPercent)}%</span>
                    </div>
                    <Progress value={paidPercent} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{t("home.paid")}: {formatINR(debt.total_paid)}</span>
                      <span>{t("home.remaining")}: {formatINR(remaining)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </motion.section>
      )}

      {goals.length > 0 && (
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t("home.goalProgress")}</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("/goals")}>
              {t("home.viewAll")} <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
          <div className="space-y-2">
            {goals.slice(0, 3).map((goal) => {
              const savedPercent = Number(goal.target_amount) > 0 ? Math.min((Number(goal.saved_amount) / Number(goal.target_amount)) * 100, 100) : 0;
              return (
                <Card key={goal.id} className="border-0 shadow-sm">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{goal.title}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{Math.round(savedPercent)}%</span>
                    </div>
                    <Progress value={savedPercent} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{t("home.saved")}: {formatINR(goal.saved_amount)}</span>
                      <span>{t("home.target")}: {formatINR(goal.target_amount)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </motion.section>
      )}

      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("home.recentTransactions")}</h2>
          <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("/transactions")}>
            {t("home.viewAll")} <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
        {todayTx.length === 0 ? (
          <Card><CardContent className="p-4 text-center text-sm text-muted-foreground">{t("home.noTransactions")}</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {todayTx.map((tx) => (
              <Card key={tx.id} className="border-0 shadow-sm">
                <CardContent className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${tx.type === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                      {tx.type === "income" ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tx.category}{tx.platform ? ` - ${tx.platform}` : ""}</p>
                      <p className="text-xs text-muted-foreground">{tx.description || tx.category}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-bold ${tx.type === "income" ? "text-success" : "text-destructive"}`}>
                    {tx.type === "income" ? "+" : "-"}{formatINR(tx.amount)}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </motion.section>
      </div>
    </div>
  );
}
