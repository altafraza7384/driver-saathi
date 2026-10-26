import { Plus, Minus, Car, StickyNote, ChevronRight, Target, CreditCard, Heart, AlertTriangle, Wallet } from "lucide-react";
import { AdBanner } from "@/components/AdBanner";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { formatINR, toAmount, clampPercent } from "@/lib/currency";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { NotificationBell } from "@/components/NotificationBell";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { currentMonth, monthRange, budgetStatus, Budget, localToday } from "@/lib/budgets";

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

function HomeSkeleton() {
  return (
    <div className="space-y-5">
      <div className="px-4 pt-6 pb-3">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="space-y-5 p-4 pt-0">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="w-full aspect-square rounded-2xl" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function HomePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = localToday(); // local date, not UTC (audit 2026-10-24)

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await db.from("profiles").select("full_name").eq("user_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: todayTx = [], isLoading: txLoading } = useQuery({
    queryKey: ["transactions_today"],
    queryFn: async () => {
      const { data, error } = await db.from("transactions").select("*").eq("transaction_date", today).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Totals must cover ALL of today's transactions — the recent list above is
  // capped at 5 for display, so summing it under-reports on busy days. The key
  // extends ["transactions_today"], which the write pages already invalidate
  // (react-query invalidates by key prefix), so totals refresh after mutations.
  const { data: todayTxTotals = [], isError: todayError, refetch: refetchToday } = useQuery({
    queryKey: ["transactions_today", "totals"],
    queryFn: async () => {
      const { data, error } = await db.from("transactions").select("*").eq("transaction_date", today);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: debts = [], isError: debtsError, refetch: refetchDebts } = useQuery({
    queryKey: ["debts_active"],
    queryFn: async () => {
      // Legacy debts have no is_active flag (it predates creation-time
      // defaults); only an explicit false means inactive — same rule as
      // DebtsPage, so the Home widget stops hiding legacy loans
      // (audit 2026-10-24). Server-side eq(true) would exclude them.
      const { data, error } = await db.from("debts").select("*");
      if (error) throw error;
      return (data ?? []).filter((d: any) => d.is_active !== false);
    },
    enabled: !!user,
  });

  const { data: goals = [], isError: goalsError, refetch: refetchGoals } = useQuery({
    queryKey: ["goals_active"],
    queryFn: async () => {
      const { data, error } = await db.from("goals").select("*").eq("is_completed", false);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // Monthly budgets for the Home widget (current month only). Spent is
  // summed from this month's expense transactions, same as BudgetsPage.
  const thisMonth = currentMonth();
  const { start: monthStart, end: monthEnd } = monthRange(thisMonth);
  const { data: monthBudgets = [] } = useQuery({
    queryKey: ["budgets_month", thisMonth],
    queryFn: async () => {
      const { data, error } = await db.from("budgets").select("*").eq("month", thisMonth);
      if (error) throw error;
      return (data ?? []) as Budget[];
    },
    enabled: !!user,
  });
  const { data: monthTx = [] } = useQuery({
    queryKey: ["budgets_month_tx", thisMonth],
    queryFn: async () => {
      const { data, error } = await db.from("transactions").select("*").gte("transaction_date", monthStart).lte("transaction_date", monthEnd);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
  const budgetSpent: Record<string, number> = {};
  for (const tx of monthTx as any[]) {
    if (tx.type !== "expense") continue;
    budgetSpent[tx.category] = (budgetSpent[tx.category] || 0) + toAmount(tx.amount);
  }
  const budgetAtRisk = monthBudgets
    .map((b) => ({ ...b, spent: budgetSpent[b.category] || 0 }))
    .filter((b) => budgetStatus(b.spent, toAmount(b.monthly_limit)) !== "ok")
    .sort((a, b) => (b.spent / toAmount(b.monthly_limit)) - (a.spent / toAmount(a.monthly_limit)))
    .slice(0, 3);
  const budgetTotalAllocated = monthBudgets.reduce((s, b) => s + toAmount(b.monthly_limit), 0);
  const budgetTotalSpent = monthBudgets.reduce((s, b) => s + (budgetSpent[b.category] || 0), 0);

  const isInitialLoading = profileLoading && txLoading;

  if (isInitialLoading) return <HomeSkeleton />;

  const todayIncome = todayTxTotals.filter((t) => t.type === "income").reduce((s, t) => s + toAmount(t.amount), 0);
  const todayExpense = todayTxTotals.filter((t) => t.type === "expense").reduce((s, t) => s + toAmount(t.amount), 0);
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
        <AnnouncementBanner />

        {(todayError || debtsError || goalsError) && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium">{t("home.loadError")}</p>
            <button
              className="mt-1 font-medium text-primary underline"
              onClick={() => { refetchToday(); refetchDebts(); refetchGoals(); }}
            >
              {t("common.retry")}
            </button>
          </div>
        )}
      <div className="animate-in fade-in duration-300">
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
      </div>

      <div>
        <Card className="border-0 shadow-sm overflow-hidden">
          <CardContent className="p-2">
            <AdBanner className="max-h-[60px]" />
          </CardContent>
        </Card>
      </div>

      <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
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
      </section>

      {debts.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t("home.debtProgress")}</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("/debts")}>
              {t("home.viewAll")} <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
          <div className="space-y-2">
            {debts.slice(0, 3).map((debt) => {
              // Debt docs can lack total_paid (it was a Supabase column
              // default, never written by the Firestore-era form) — coerce
              // every operand so the widget can never render ₹NaN.
              const principalAmt = toAmount(debt.principal);
              const paidAmt = toAmount(debt.total_paid);
              const paidPercent = principalAmt > 0 ? clampPercent((paidAmt / principalAmt) * 100) : 0;
              const remaining = Math.max(principalAmt - paidAmt, 0);
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
                      <span>{t("home.paid")}: {formatINR(paidAmt)}</span>
                      <span>{t("home.remaining")}: {formatINR(remaining)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {goals.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t("home.goalProgress")}</h2>
            <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("/goals")}>
              {t("home.viewAll")} <ChevronRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
          <div className="space-y-2">
            {goals.slice(0, 3).map((goal) => {
              const savedNum = toAmount(goal.saved_amount);
              const targetNum = toAmount(goal.target_amount);
              const savedPercent = targetNum > 0 ? clampPercent((savedNum / targetNum) * 100) : 0;
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
                      <span>{t("home.saved")}: {formatINR(savedNum)}</span>
                      <span>{t("home.target")}: {formatINR(targetNum)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("budget.title")}</h2>
          <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => navigate("/budgets")}>
            {t("budget.viewBudgets")} <ChevronRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
        {monthBudgets.length === 0 ? (
          <Card><CardContent className="p-4 text-center text-sm text-muted-foreground">
            {t("budget.noBudgets")}{" "}
            <Button variant="link" className="p-0 h-auto text-xs" onClick={() => navigate("/budgets")}>
              {t("budget.addBudget")}
            </Button>
          </CardContent></Card>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t("budget.totalSpent")}: {formatINR(budgetTotalSpent)} / {formatINR(budgetTotalAllocated)}</span>
              </div>
              <Progress value={budgetTotalAllocated > 0 ? clampPercent((budgetTotalSpent / budgetTotalAllocated) * 100) : 0} className="h-2" />
              {budgetAtRisk.length > 0 ? (
                <div className="space-y-1">
                  {budgetAtRisk.map((b) => (
                    <p key={b.id} className="text-xs text-destructive">
                      {b.category}: {formatINR(b.spent)} / {formatINR(toAmount(b.monthly_limit))}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("budget.remaining")}: {formatINR(budgetTotalAllocated - budgetTotalSpent)}</p>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      <section>
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
                    {tx.type === "income" ? "+" : "-"}{formatINR(toAmount(tx.amount))}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
