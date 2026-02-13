import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { formatINR } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Minus, ArrowUpDown, Filter } from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";

type Transaction = {
  id: string;
  type: string;
  amount: number;
  category: string;
  platform: string | null;
  description: string | null;
  transaction_date: string;
  created_at: string;
};

const INCOME_CATEGORIES = ["Ride Earnings", "Tips", "Incentives", "Bonus", "Other"];
const EXPENSE_CATEGORIES = ["Fuel", "Maintenance", "Food", "Tolls", "Insurance", "EMI", "Phone", "Other"];

export default function TransactionsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchTransactions();
  }, [user, filter]);

  const fetchTransactions = async () => {
    let query = supabase
      .from("transactions")
      .select("*")
      .order("transaction_date", { ascending: false })
      .limit(50);

    if (filter !== "all") {
      query = query.eq("type", filter);
    }

    const { data } = await query;
    setTransactions((data as Transaction[]) || []);
    setLoading(false);
  };

  const totals = transactions.reduce(
    (acc, tx) => {
      if (tx.type === "income") acc.income += Number(tx.amount);
      else acc.expense += Number(tx.amount);
      return acc;
    },
    { income: 0, expense: 0 }
  );

  return (
    <div className="space-y-4 p-4 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("nav.transactions")}</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => navigate("/transactions/add?type=income")} className="gap-1 bg-success text-success-foreground hover:bg-success/90">
            <Plus className="h-4 w-4" /> Income
          </Button>
          <Button size="sm" onClick={() => navigate("/transactions/add?type=expense")} variant="destructive" className="gap-1">
            <Minus className="h-4 w-4" /> Expense
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-success/20 bg-success/5">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Income</p>
            <p className="text-lg font-bold text-success">{formatINR(totals.income)}</p>
          </CardContent>
        </Card>
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Expenses</p>
            <p className="text-lg font-bold text-destructive">{formatINR(totals.expense)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(["all", "income", "expense"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {f === "all" ? "All" : f === "income" ? "Income" : "Expenses"}
          </button>
        ))}
      </div>

      {/* Transaction List */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : transactions.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">{t("home.noTransactions")}</CardContent></Card>
        ) : (
          transactions.map((tx, i) => (
            <motion.div key={tx.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className="border-0 shadow-sm">
                <CardContent className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      tx.type === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                    }`}>
                      {tx.type === "income" ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tx.category}{tx.platform ? ` • ${tx.platform}` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(tx.transaction_date), "dd MMM yyyy")}
                        {tx.description ? ` • ${tx.description}` : ""}
                      </p>
                    </div>
                  </div>
                  <span className={`text-sm font-bold ${tx.type === "income" ? "text-success" : "text-destructive"}`}>
                    {tx.type === "income" ? "+" : "-"}{formatINR(Number(tx.amount))}
                  </span>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

export { INCOME_CATEGORIES, EXPENSE_CATEGORIES };
