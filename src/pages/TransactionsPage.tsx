import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { formatINR } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Minus, Trash2, Pencil } from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [saving, setSaving] = useState(false);

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

  const handleDelete = async (id: string) => {
    await supabase.from("transactions").delete().eq("id", id);
    toast({ title: "Transaction deleted" });
    fetchTransactions();
  };

  const openEdit = (tx: Transaction) => {
    setEditTx(tx);
    setEditAmount(String(tx.amount));
    setEditCategory(tx.category);
    setEditDescription(tx.description || "");
    setEditDate(tx.transaction_date);
  };

  const handleUpdate = async () => {
    if (!editTx) return;
    setSaving(true);
    const { error } = await supabase.from("transactions").update({
      amount: parseFloat(editAmount),
      category: editCategory,
      description: editDescription || null,
      transaction_date: editDate,
    }).eq("id", editTx.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Transaction updated" });
      setEditTx(null);
      fetchTransactions();
    }
    setSaving(false);
  };

  const totals = transactions.reduce(
    (acc, tx) => {
      if (tx.type === "income") acc.income += Number(tx.amount);
      else acc.expense += Number(tx.amount);
      return acc;
    },
    { income: 0, expense: 0 }
  );

  const categoryOptions = editTx?.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <div className="space-y-4 p-4 pt-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold sm:text-2xl">{t("nav.transactions")}</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => navigate("/transactions/add?type=income")} className="flex-1 gap-1 bg-success text-success-foreground hover:bg-success/90 sm:flex-none">
            <Plus className="h-4 w-4" /> Income
          </Button>
          <Button size="sm" onClick={() => navigate("/transactions/add?type=expense")} variant="destructive" className="flex-1 gap-1 sm:flex-none">
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
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      tx.type === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                    }`}>
                      {tx.type === "income" ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{tx.category}{tx.platform ? ` • ${tx.platform}` : ""}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {format(new Date(tx.transaction_date), "dd MMM yyyy")}
                        {tx.description ? ` • ${tx.description}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-sm font-bold ${tx.type === "income" ? "text-success" : "text-destructive"}`}>
                      {tx.type === "income" ? "+" : "-"}{formatINR(Number(tx.amount))}
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(tx)}>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(tx.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editTx} onOpenChange={(open) => !open && setEditTx(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Transaction</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <Input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} min="1" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleUpdate} disabled={saving}>
              {saving ? "Saving..." : "Update Transaction"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { INCOME_CATEGORIES, EXPENSE_CATEGORIES };
