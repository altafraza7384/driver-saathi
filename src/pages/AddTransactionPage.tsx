import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { localToday } from "@/lib/budgets";
import { friendlyErrorMessage } from "@/lib/errors";
import { ArrowLeft } from "lucide-react";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "./TransactionsPage";

const PLATFORMS = ["Ola", "Uber", "Rapido", "BluSmart", "Namma Yatri", "Other"];

export default function AddTransactionPage() {
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get("type") === "expense" ? "expense" : searchParams.get("type") === "income" ? "income" : "";
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [type, setType] = useState<"income" | "expense">(initialType as "income" | "expense" || "income");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [platform, setPlatform] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(localToday());
  const [loading, setLoading] = useState(false);

  const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Never silently do nothing: if the Select's required validation
    // doesn't fire in the WebView, the user got zero feedback (audit
    // 2026-10-24). Tell them what is missing.
    if (!user || !amount || !category) {
      toast({ title: t("tx.missingFields"), variant: "destructive" });
      return;
    }
    setLoading(true);

    const { error } = await db.from("transactions").insert({
      user_id: user.id,
      type,
      amount: parseFloat(amount),
      category,
      platform: platform || null,
      description: description || null,
      transaction_date: date,
    });

    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: type === "income" ? t("tx.incomeAdded") : t("tx.expenseAdded") });
      // Home reads transactions via react-query (["transactions_today"],
      // 5-minute staleTime): invalidate so the dashboard reflects the new
      // entry on return instead of staying stale until a reload.
      queryClient.invalidateQueries({ queryKey: ["transactions_today"] });
      queryClient.invalidateQueries({ queryKey: ["budgets_month_tx"] });
      queryClient.invalidateQueries({ queryKey: ["budgets_month"] });
      navigate("/transactions");
    }
    setLoading(false);
  };

  return (
    <div className="p-4 pt-6">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </button>

      <Card>
        <CardHeader>
          <CardTitle>{t("home.addTransaction")}</CardTitle>
          <div className="flex gap-2 mt-2">
            <Button
              type="button"
              variant={type === "income" ? "default" : "outline"}
              className={`flex-1 ${type === "income" ? "bg-success hover:bg-success/90 text-success-foreground" : ""}`}
              onClick={() => { setType("income"); setCategory(""); }}
            >
              {t("home.addIncome")}
            </Button>
            <Button
              type="button"
              variant={type === "expense" ? "default" : "outline"}
              className={`flex-1 ${type === "expense" ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""}`}
              onClick={() => { setType("expense"); setCategory(""); }}
            >
              {t("home.addExpense")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("common.amount")} (₹)</Label>
              <Input
                type="number"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-2xl font-bold"
                min="1"
                step="0.01"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>{t("common.category")}</Label>
              <Select value={category} onValueChange={setCategory} required>
                <SelectTrigger><SelectValue placeholder={t("form.selectCategory")} /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {type === "income" && (
              <div className="space-y-2">
                <Label>{t("tx.platform")}</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger><SelectValue placeholder={t("form.selectPlatform")} /></SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="tx-date">{t("common.date")}</Label>
              <DatePicker id="tx-date" label={t("common.date")} value={date} onChange={setDate} required />
            </div>

            <div className="space-y-2">
              <Label>{t("common.description")} ({t("common.optional")})</Label>
              <Input
                placeholder={t("tx.addNote")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              className={`w-full ${type === "income" ? "bg-success hover:bg-success/90" : ""}`}
              disabled={loading}
            >
              {loading ? "Saving..." : type === "income" ? "Add Income" : "Add Expense"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
