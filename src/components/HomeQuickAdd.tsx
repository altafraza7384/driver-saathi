import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { localToday } from "@/lib/budgets";
import { formatINR, toAmount } from "@/lib/currency";
import { calcStreak, daysAgoStr, prevDayStr } from "@/lib/streak";
import { friendlyErrorMessage } from "@/lib/errors";
import { Flame, X } from "lucide-react";

// Quick-add for the daily habit: amount + category, save in 2 taps.
// Category lists MUST match TransactionsPage INCOME/EXPENSE_CATEGORIES
// byte-for-byte (budget mapping depends on the exact English strings),
// so they are duplicated here with that comment instead of importing the
// whole TransactionsPage into the Home chunk.
const INCOME_CATEGORIES = ["Ride Earnings", "Tips", "Incentives", "Bonus", "Other"];
const EXPENSE_CATEGORIES = ["Fuel", "Maintenance", "Food", "Tolls", "Insurance", "EMI", "Phone", "Subscription", "Other"];

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: defaults just don't persist, the form still works.
  }
}

type Result = { profit: number; diff: number };

export function HomeQuickAdd() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = localToday();
  const yesterday = prevDayStr(today);

  const [type, setType] = useState<"income" | "expense">(() =>
    readPref("quickadd_type", "income") === "expense" ? "expense" : "income"
  );
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState(() =>
    readPref(`quickadd_cat_${readPref("quickadd_type", "income")}`, "")
  );
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const activeCategory = categories.includes(category) ? category : categories[0];

  // Streak: distinct local dates with >= 1 transaction in the last 400 days.
  const { data: streakDates = [] } = useQuery({
    queryKey: ["transactions_streak"],
    queryFn: async () => {
      const { data, error } = await db.from("transactions").select("*").gte("transaction_date", daysAgoStr(today, 400)).limit(2000);
      if (error) throw error;
      return (data ?? []).map((tx: any) => tx.transaction_date as string).filter(Boolean);
    },
    enabled: !!user,
  });
  const streak = calcStreak(streakDates, today);

  // Today's totals share HomePage's ["transactions_today", "totals"] cache,
  // so this adds no extra fetch; yesterday's totals are one small query.
  const { data: todayTotals = [] } = useQuery({
    queryKey: ["transactions_today", "totals"],
    queryFn: async () => {
      const { data, error } = await db.from("transactions").select("*").eq("transaction_date", today);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const { data: yesterdayTotals = [] } = useQuery({
    queryKey: ["transactions_day", yesterday],
    queryFn: async () => {
      const { data, error } = await db.from("transactions").select("*").eq("transaction_date", yesterday);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const sumByType = (rows: any[], txType: string) =>
    rows.filter((tx) => tx.type === txType).reduce((s, tx) => s + toAmount(tx.amount), 0);

  const handleSave = async () => {
    const value = parseFloat(amount);
    if (!user || !amount || Number.isNaN(value) || value <= 0 || !activeCategory) {
      toast({ title: t("tx.missingFields"), variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await db.from("transactions").insert({
      user_id: user.id,
      type,
      amount: value,
      category: activeCategory,
      platform: null,
      description: null,
      transaction_date: today,
    });
    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: type === "income" ? t("tx.incomeAdded") : t("tx.expenseAdded") });
      writePref("quickadd_type", type);
      writePref(`quickadd_cat_${type}`, activeCategory);
      // "Aaj ka result": today's profit including this entry (computed from
      // cache + the new entry, so it shows instantly without waiting for
      // the refetch), compared with yesterday's profit.
      const todayIncome = sumByType(todayTotals, "income") + (type === "income" ? value : 0);
      const todayExpense = sumByType(todayTotals, "expense") + (type === "expense" ? value : 0);
      const profit = todayIncome - todayExpense;
      const yesterdayProfit = sumByType(yesterdayTotals, "income") - sumByType(yesterdayTotals, "expense");
      setResult({ profit, diff: profit - yesterdayProfit });
      queryClient.invalidateQueries({ queryKey: ["transactions_today"] });
      queryClient.invalidateQueries({ queryKey: ["transactions_streak"] });
      queryClient.invalidateQueries({ queryKey: ["budgets_month_tx"] });
      queryClient.invalidateQueries({ queryKey: ["budgets_month"] });
      setAmount("");
    }
    setSaving(false);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">{t("home.quickAddTitle")}</h2>
          {streak > 0 && (
            <span className="flex items-center gap-1 text-sm font-bold text-amber-600">
              <Flame className="h-4 w-4" /> {t("home.streak", { days: streak })}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("home.quickAddHint")}</p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={type === "income" ? "default" : "outline"}
            className={`flex-1 ${type === "income" ? "bg-success hover:bg-success/90 text-success-foreground" : ""}`}
            onClick={() => setType("income")}
          >
            {t("home.addIncome")}
          </Button>
          <Button
            type="button"
            variant={type === "expense" ? "default" : "outline"}
            className={`flex-1 ${type === "expense" ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""}`}
            onClick={() => setType("expense")}
          >
            {t("home.addExpense")}
          </Button>
        </div>
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={t("common.amount")}
        />
        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full border px-3 py-1 text-xs font-medium active:scale-95 transition-transform ${
                c === activeCategory ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <Button className="w-full" onClick={handleSave} disabled={saving || !amount}>
          {t("common.save")}
        </Button>

        {result && (
          <div className="relative rounded-lg border border-success/40 bg-success/10 p-4 text-center space-y-1">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setResult(null)}
              className="absolute right-2 top-2 text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="text-sm font-bold">🎉 {t("home.todayResult")}</p>
            <p className="text-2xl font-extrabold">
              {t("home.todayProfit")}: {formatINR(result.profit)}
            </p>
            <p className="text-sm text-muted-foreground">
              {result.diff > 0
                ? t("home.profitUp", { amount: formatINR(result.diff) })
                : result.diff < 0
                  ? t("home.profitDown", { amount: formatINR(-result.diff) })
                  : t("home.profitSame")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
