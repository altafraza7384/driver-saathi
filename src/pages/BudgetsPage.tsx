import { categoryLabel } from "@/lib/categories";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { formatINR, toAmount, clampPercent } from "@/lib/currency";
import { friendlyErrorMessage } from "@/lib/errors";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Wallet, Copy } from "lucide-react";
import {
  BUDGET_CATEGORIES,
  Budget,
  currentMonth,
  prevMonth,
  nextMonth,
  monthRange,
  monthLabel,
  budgetStatus,
} from "@/lib/budgets";

type Transaction = {
  id: string;
  type: string;
  amount: number;
  category: string;
  transaction_date: string;
};

export default function BudgetsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(currentMonth());
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [spentByCategory, setSpentByCategory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Add/edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [amount, setAmount] = useState("");
  // Form-sheet pattern (Phase 6, presentation only): validation messages
  // are shown directly beneath their field, in addition to the existing
  // toast. Each error slot is always rendered with a reserved height so
  // the footer below it does not move when an error appears. Field
  // values are never cleared on a failed validation.
  const [fieldErrors, setFieldErrors] = useState<{ category?: string; amount?: string }>({});

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { start, end } = monthRange(month);

    const { data: budgetsData } = await db
      .from("budgets")
      .select("*")
      .eq("user_id", user.id)
      .eq("month", month);

    const { data: txData } = await db
      .from("transactions")
      .select("id, type, amount, category, transaction_date")
      .eq("user_id", user.id)
      .eq("type", "expense")
      .gte("transaction_date", start)
      .lt("transaction_date", end);

    if (budgetsData) setBudgets(budgetsData);

    const spent: Record<string, number> = {};
    (txData as Transaction[] | null)?.forEach((tx) => {
      spent[tx.category] = (spent[tx.category] || 0) + toAmount(tx.amount);
    });
    setSpentByCategory(spent);
    setLoading(false);
  }, [user, month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalBudget = budgets.reduce((sum, b) => sum + toAmount(b.amount), 0);
  const totalSpent = Object.values(spentByCategory).reduce((a, b) => a + b, 0);
  const remaining = totalBudget - totalSpent;

  const openAddDialog = () => {
    setEditingBudget(null);
    setSelectedCategory("");
    setAmount("");
    setFieldErrors({});
    setDialogOpen(true);
  };

  const openEditDialog = (budget: Budget) => {
    setEditingBudget(budget);
    setSelectedCategory(budget.category);
    setAmount(String(budget.amount));
    setFieldErrors({});
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setFieldErrors({});
    if (!selectedCategory) {
      toast({ title: t("form.checkInput"), description: t("budget.category"), variant: "destructive" });
      setFieldErrors({ category: t("budget.category") });
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast({ title: "Error", description: t("budget.invalidAmount"), variant: "destructive" });
      setFieldErrors({ amount: t("budget.invalidAmount") });
      return;
    }
    if (!user) return;

    const data = {
      user_id: user.id,
      category: selectedCategory,
      amount: parseFloat(amount),
      month,
    };

    const { error } = editingBudget
      ? await db.from("budgets").update(data).eq("id", editingBudget.id)
      : await db.from("budgets").insert(data);

    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: editingBudget ? t("budget.updated") : t("budget.created") });
      setDialogOpen(false);
      setSelectedCategory("");
      setAmount("");
      setEditingBudget(null);
      setFieldErrors({});
      loadData();
      queryClient.invalidateQueries({ queryKey: ["budgets_month"] });
      queryClient.invalidateQueries({ queryKey: ["budgets_month_tx"] });
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from("budgets").delete().eq("id", id);
    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: t("budget.deleted") });
      loadData();
      queryClient.invalidateQueries({ queryKey: ["budgets_month"] });
      queryClient.invalidateQueries({ queryKey: ["budgets_month_tx"] });
    }
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">{t("budget.title")}</h1>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => setMonth(prevMonth(month))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-semibold">{monthLabel(month, t)}</span>
        <Button variant="outline" size="icon" onClick={() => setMonth(nextMonth(month))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          <Card className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                <span>{t("budget.monthlyBudget")}</span>
              </div>
              <p className="text-3xl font-bold">{formatINR(totalBudget)}</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="opacity-80">{t("budget.spent")}</p>
                  <p className="font-semibold">{formatINR(totalSpent)}</p>
                </div>
                <div>
                  <p className="opacity-80">{t("budget.remaining")}</p>
                  <p className="font-semibold">{formatINR(remaining)}</p>
                </div>
              </div>
              {totalBudget > 0 && (
                <Progress value={clampPercent((totalSpent / totalBudget) * 100)} className="bg-white/20" />
              )}
            </CardContent>
          </Card>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" onClick={openAddDialog}>
                <Plus className="h-4 w-4 mr-2" /> {t("budget.addBudget")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingBudget ? t("budget.editBudget") : t("budget.addBudget")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="budget-category">{t("budget.category")}</Label>
                  <Select value={selectedCategory} onValueChange={(v) => { setSelectedCategory(v); setFieldErrors((prev) => ({ ...prev, category: undefined })); }}>
                    <SelectTrigger id="budget-category" aria-describedby="budget-category-error">
                      <SelectValue placeholder={t("form.selectCategory")} />
                    </SelectTrigger>
                    <SelectContent>
                      {BUDGET_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{categoryLabel(t, c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p id="budget-category-error" className="min-h-5 text-sm text-destructive">{fieldErrors.category ?? ""}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="budget-amount">{t("budget.amount")} (₹)</Label>
                  <Input
                    id="budget-amount"
                    type="number"
                    placeholder="5000"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setFieldErrors((prev) => ({ ...prev, amount: undefined })); }}
                    aria-describedby="budget-amount-error"
                  />
                  <p id="budget-amount-error" className="min-h-5 text-sm text-destructive">{fieldErrors.amount ?? ""}</p>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button onClick={handleSave} className="flex-1">
                    {editingBudget ? t("common.update") : t("common.save")}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {budgets.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                {t("budget.noBudgets")}
              </CardContent>
            </Card>
          ) : (
            budgets.map((budget) => {
              const spent = spentByCategory[budget.category] || 0;
              const percent = toAmount(budget.amount) > 0 ? (spent / toAmount(budget.amount)) * 100 : 0;
              const status = budgetStatus(spent, toAmount(budget.amount));
              return (
                <Card key={budget.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{categoryLabel(t, budget.category)}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatINR(spent)} {t("common.of")} {formatINR(budget.amount)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(budget)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(budget.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Progress value={clampPercent(percent)} />
                    <p className={`text-sm ${status === "over" ? "text-destructive" : status === "warning" ? "text-warning" : "text-muted-foreground"}`}>
                      {status === "over"
                        ? t("budget.overBudget")
                        : status === "warning"
                          ? t("budget.nearLimit")
                          : `${Math.round(percent)}% ${t("budget.used")}`}
                    </p>
                  </CardContent>
                </Card>
              );
            })
          )}

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{t("budget.quickTip")}</p>
                <Button variant="ghost" size="sm" onClick={() => {}}>
                  <Copy className="h-4 w-4" /> {t("budget.copyLastMonth")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
