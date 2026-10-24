import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { formatINR, toAmount, clampPercent } from "@/lib/currency";
import { friendlyErrorMessage } from "@/lib/errors";
import { Card, CardContent } from "@/components/ui/card";
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
  const [editing, setEditing] = useState<Budget | null>(null);
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { start, end } = monthRange(month);
    const [{ data: budgetData, error: budgetError }, { data: txData, error: txError }] = await Promise.all([
      db.from("budgets").select("*").eq("month", month),
      db.from("transactions").select("*").gte("transaction_date", start).lte("transaction_date", end),
    ]);
    // Surface fetch failures instead of rendering a misleading "no
    // budgets" empty state (audit 2026-10-24).
    if (budgetError || txError) {
      toast({ title: t("home.loadError"), variant: "destructive" });
    }
    setBudgets((budgetData as Budget[]) || []);
    const spent: Record<string, number> = {};
    for (const tx of (txData as Transaction[]) || []) {
      if (tx.type !== "expense") continue;
      spent[tx.category] = (spent[tx.category] || 0) + toAmount(tx.amount);
    }
    setSpentByCategory(spent);
    setLoading(false);
  }, [user, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["budgets_month"] });
    queryClient.invalidateQueries({ queryKey: ["budgets_month_tx"] });
    queryClient.invalidateQueries({ queryKey: ["transactions_today"] });
  };

  const openAdd = () => {
    setEditing(null);
    setCategory("");
    setLimit("");
    setDialogOpen(true);
  };

  const openEdit = (b: Budget) => {
    setEditing(b);
    setCategory(b.category);
    setLimit(String(toAmount(b.monthly_limit)));
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !category) return;
    const amt = parseFloat(limit);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Error", description: t("budget.invalidAmount"), variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = editing
      ? await db.from("budgets").update({ monthly_limit: amt } as any).eq("id", editing.id)
      : await db.from("budgets").insert({ user_id: user.id, category, monthly_limit: amt, month } as any);
    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: editing ? t("budget.updated") : t("budget.created") });
      setDialogOpen(false);
      invalidate();
      fetchData();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from("budgets").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      setConfirmDeleteId(null);
      invalidate();
      fetchData();
    }
  };

  const handleCopyLastMonth = async () => {
    if (!user) return;
    setCopying(true);
    const last = prevMonth(month);
    const { data } = await db.from("budgets").select("*").eq("month", last);
    const existing = new Set(budgets.map((b) => b.category));
    const toCopy = ((data as Budget[]) || []).filter((b) => !existing.has(b.category));
    // Report partial failure honestly: the old code toasted "copied"
    // even when inserts failed (audit 2026-10-24).
    const failures: string[] = [];
    for (const b of toCopy) {
      const { error } = await db.from("budgets").insert({
        user_id: user.id,
        category: b.category,
        monthly_limit: toAmount(b.monthly_limit),
        month,
      } as any);
      if (error) failures.push(b.category);
    }
    if (failures.length > 0) {
      toast({ title: "Copy partially failed", description: failures.join(", "), variant: "destructive" });
    } else {
      toast({ title: t("budget.copied") });
    }
    setCopying(false);
    invalidate();
    fetchData();
  };

  const availableCategories = BUDGET_CATEGORIES.filter(
    (c) => !budgets.some((b) => b.category === c) || (editing && editing.category === c),
  );

  const totalAllocated = budgets.reduce((s, b) => s + toAmount(b.monthly_limit), 0);
  const totalSpent = budgets.reduce((s, b) => s + (spentByCategory[b.category] || 0), 0);
  const totalRemaining = totalAllocated - totalSpent;

  return (
    <div className="space-y-5 p-4 pt-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Wallet className="h-5 w-5" /> {t("budget.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("budget.subtitle")}</p>
        </div>
      </div>

      {/* Month picker */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => setMonth(prevMonth(month))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-bold">{monthLabel(month)}</span>
        <Button variant="outline" size="icon" onClick={() => setMonth(nextMonth(month))} disabled={month >= currentMonth()}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">{t("budget.totalAllocated")}</p>
          <p className="font-bold">{formatINR(totalAllocated)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">{t("budget.totalSpent")}</p>
          <p className="font-bold">{formatINR(totalSpent)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">{t("budget.remaining")}</p>
          <p className={`font-bold ${totalRemaining < 0 ? "text-destructive" : ""}`}>{formatINR(totalRemaining)}</p>
        </CardContent></Card>
      </div>

      <p className="text-xs text-muted-foreground">{t("budget.warningNote")}</p>

      <div className="flex gap-2">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAdd} className="gap-1">
              <Plus className="h-4 w-4" /> {t("budget.addBudget")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? t("budget.editBudget") : t("budget.addBudget")}</DialogTitle></DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("budget.category")}</Label>
                <Select value={category} onValueChange={setCategory} disabled={!!editing}>
                  <SelectTrigger><SelectValue placeholder={t("budget.category")} /></SelectTrigger>
                  <SelectContent>
                    {availableCategories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("budget.monthlyLimit")}</Label>
                <Input type="number" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} required />
              </div>
              <Button type="submit" disabled={saving} className="w-full">
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Button variant="outline" onClick={handleCopyLastMonth} disabled={copying} className="gap-1">
          <Copy className="h-4 w-4" /> {t("budget.copyLastMonth")}
        </Button>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground">{t("budget.loading")}</p>
      ) : budgets.length === 0 ? (
        <Card><CardContent className="p-4 text-center text-sm text-muted-foreground">
          {t("budget.noBudgets")} {t("budget.addFirst")}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => {
            const spent = spentByCategory[b.category] || 0;
            const limitAmt = toAmount(b.monthly_limit);
            const pct = limitAmt > 0 ? clampPercent((spent / limitAmt) * 100) : 0;
            const status = budgetStatus(spent, limitAmt);
            const remaining = limitAmt - spent;
            return (
              <Card key={b.id} className="border-0 shadow-sm">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{b.category}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(b)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {confirmDeleteId === b.id ? (
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(b.id)}>
                          {t("common.delete")}
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" onClick={() => setConfirmDeleteId(b.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <Progress value={pct} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t("budget.spent")}: {formatINR(spent)}</span>
                    <span>{t("budget.monthlyLimit")}: {formatINR(limitAmt)}</span>
                  </div>
                  <p className={`text-xs font-bold ${status === "over" ? "text-destructive" : status === "near" ? "text-amber-600" : "text-muted-foreground"}`}>
                    {status === "over"
                      ? `${t("budget.overBudget")}: ${t("budget.overBy")} ${formatINR(-remaining)}`
                      : status === "near"
                        ? t("budget.nearLimit")
                        : `${t("budget.remaining")}: ${formatINR(remaining)}`}
                  </p>
                </CardContent>
              </Card>
            );
          })}
          {totalRemaining > 0 && (
            <Card><CardContent className="p-3 text-sm">
              {t("budget.savingsHint", { amount: formatINR(totalRemaining) })}
              <Button variant="link" className="p-0 h-auto ml-1 text-xs" onClick={() => navigate("/goals")}>
                {t("more.goalsSavings")}
              </Button>
            </CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}
