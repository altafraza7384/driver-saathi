import { useState, useEffect } from "react";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { formatINR, toAmount } from "@/lib/currency";
import { localToday, currentMonth } from "@/lib/budgets";
import { friendlyErrorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Home, Banknote, Calendar } from "lucide-react";
import { motion } from "framer-motion";
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

type RecurringExpense = {
  id: string;
  name: string;
  category: string;
  amount: number;
  due_day: number;
  notify_at: string | null;
  is_active: boolean;
  last_paid_date: string | null;
  note: string | null;
};

const CATEGORIES = [
  { value: "rent", key: "recurring.catRent" },
  { value: "electricity", key: "recurring.catElectricity" },
  { value: "water", key: "recurring.catWater" },
  { value: "internet", key: "recurring.catInternet" },
  { value: "mobile", key: "recurring.catMobile" },
  { value: "gas", key: "recurring.catGas" },
  { value: "subscription", key: "recurring.catSubscription" },
  { value: "insurance", key: "recurring.catInsurance" },
  { value: "other", key: "recurring.catOther" },
];

// Recurring-bill categories are stored lowercase, but transaction and
// budget categories are capitalised (TransactionsPage EXPENSE_CATEGORIES).
// Map at insert time so a paid Subscription/Insurance/Phone bill actually
// counts toward that budget (audit 2026-10-24: "subscription" !==
// "Subscription" meant budget spent never moved). The bill's own name is
// kept in the transaction description, so no detail is lost.
const TX_CATEGORY_MAP: Record<string, string> = {
  subscription: "Subscription",
  insurance: "Insurance",
  mobile: "Phone",
};

function nextNotifyDate(dueDay: number): string {
  const now = new Date();
  // Clamp the day to the month's length: a 31st bill must notify on
  // 28 Feb, not roll over to 3 Mar (audit 2026-10-24).
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const day = Math.min(dueDay, daysInMonth(now.getFullYear(), now.getMonth()));
  const target = new Date(now.getFullYear(), now.getMonth(), day, 9, 0, 0);
  if (target.getTime() <= now.getTime()) {
    const ny = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const nm = (now.getMonth() + 1) % 12;
    target.setFullYear(ny, nm, Math.min(dueDay, daysInMonth(ny, nm)));
    target.setHours(9, 0, 0, 0);
  }
  return target.toISOString();
}

export default function RecurringExpenses() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  // form
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("rent");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (user) fetchItems();
  }, [user]);

  const fetchItems = async () => {
    const { data } = await db
      .from("recurring_expenses")
      .select("*")
      .order("due_day", { ascending: true });
    setItems((data as RecurringExpense[]) || []);
    setLoading(false);
  };

  const resetForm = () => {
    setEditing(null);
    setName(""); setCategory("rent"); setAmount(""); setDueDay("1"); setNote("");
  };

  const openEdit = (it: RecurringExpense) => {
    setEditing(it);
    setName(it.name);
    setCategory(it.category);
    setAmount(String(toAmount(it.amount)));
    setDueDay(String(it.due_day));
    setNote(it.note || "");
    setShowAdd(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast({ title: "Error", description: "Please enter a valid amount.", variant: "destructive" });
      setSaving(false);
      return;
    }

    const payload = {
      user_id: user.id,
      name,
      category,
      amount: amt,
      due_day: Math.min(31, Math.max(1, parseInt(dueDay) || 1)),
      notify_at: nextNotifyDate(parseInt(dueDay) || 1),
      note: note || null,
    };

    const { error } = editing
      ? await db.from("recurring_expenses").update(payload).eq("id", editing.id)
      : await db.from("recurring_expenses").insert(payload);

    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: editing ? "Expense updated!" : "Expense added!" });
      setShowAdd(false);
      resetForm();
      fetchItems();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from("recurring_expenses").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
      return;
    }
    toast({ title: "Expense removed" });
    fetchItems();
  };

  const handleMarkPaid = async (it: RecurringExpense) => {
    if (!user || payingId) return;
    // One payment per bill per month: without this guard a double-tap
    // created two payment docs + two transactions (audit 2026-10-24).
    const thisMonth = currentMonth();
    if (it.last_paid_date?.slice(0, 7) === thisMonth) {
      toast({ title: "Already paid this month" });
      return;
    }
    setPayingId(it.id);
    const paidAmount = toAmount(it.amount);
    const { error: paymentError } = await db.from("recurring_expense_payments").insert({
      user_id: user.id,
      expense_id: it.id,
      amount: paidAmount,
    });
    if (paymentError) {
      toast({ title: "Error", description: friendlyErrorMessage(paymentError), variant: "destructive" });
      setPayingId(null);
      return;
    }
    // Also create a regular transaction record so it shows in finance.
    // transaction_date is REQUIRED: without it the payment was excluded
    // from every date-filtered view (Home today, Transactions, Budgets)
    // and the money silently vanished from finance (audit 2026-10-24).
    const { error: txError } = await db.from("transactions").insert({
      user_id: user.id,
      type: "expense",
      category: TX_CATEGORY_MAP[it.category] ?? "Other",
      amount: paidAmount,
      description: it.name,
      transaction_date: localToday(),
    });
    if (txError) {
      toast({ title: "Error", description: friendlyErrorMessage(txError), variant: "destructive" });
      setPayingId(null);
      return;
    }
    const { error: updateError } = await db
      .from("recurring_expenses")
      .update({ last_paid_date: localToday() })
      .eq("id", it.id);
    if (updateError) {
      toast({ title: "Error", description: friendlyErrorMessage(updateError), variant: "destructive" });
      setPayingId(null);
      return;
    }
    // The payment also created a transaction: refresh Home's summary
    // and the Home budget widget (it reads budgets_month_tx).
    queryClient.invalidateQueries({ queryKey: ["transactions_today"] });
    queryClient.invalidateQueries({ queryKey: ["budgets_month_tx"] });
    queryClient.invalidateQueries({ queryKey: ["budgets_month"] });
    toast({ title: `✅ Paid ${formatINR(paidAmount)}` });
    setPayingId(null);
    fetchItems();
  };

  const totalMonthly = items
    .filter((i) => i.is_active)
    .reduce((s, i) => s + toAmount(i.amount), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 pt-2">
        <div>
          <h2 className="text-base font-bold sm:text-lg">{t("recurring.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("recurring.subtitle")}</p>
        </div>
        <Dialog
          open={showAdd}
          onOpenChange={(o) => {
            setShowAdd(o);
            if (!o) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <Plus className="h-4 w-4" /> {t("recurring.addBill")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? t("recurring.editBill") : t("recurring.addRecurringBill")}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("recurring.name")}</Label>
                <Input
                  placeholder="e.g. Room Rent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t("recurring.category")}</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{t(c.key)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("recurring.amount")}</Label>
                  <Input
                    type="number"
                    placeholder="8000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="1"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("recurring.dueDay")}</Label>
                <Input
                  type="number"
                  placeholder="5"
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  min="1"
                  max="31"
                  required
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("recurring.dueNote")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("recurring.note")}</Label>
                <Input
                  placeholder="Landlord name, account no, etc."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? t("common.saving") : editing ? t("recurring.updateBill") : t("recurring.addBill")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {items.length > 0 && (
        <Card className="bg-accent/30 border-accent/40">
          <CardContent className="p-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t("recurring.totalMonthly")}</span>
            <span className="text-base font-bold">{formatINR(totalMonthly)}</span>
          </CardContent>
        </Card>
      )}

      {loading ? null : items.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-center text-xs text-muted-foreground">
            No recurring bills yet. Add rent, electricity, internet etc.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <motion.div
              key={it.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Home className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{it.name}</p>
                        <p className="text-[11px] text-muted-foreground capitalize flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> Day {it.due_day} · {it.category}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-0 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(it)}>
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(it.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold">{formatINR(toAmount(it.amount))}</span>
                    {it.last_paid_date && (
                      <span className="text-[10px] text-muted-foreground">
                        Last: {new Date(it.last_paid_date).toLocaleDateString("en-IN")}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-8"
                    onClick={() => handleMarkPaid(it)}
                    disabled={payingId === it.id || it.last_paid_date?.slice(0, 7) === currentMonth()}
                  >
                    <Banknote className="h-3.5 w-3.5 mr-1" /> {it.last_paid_date?.slice(0, 7) === currentMonth() ? t("recurring.paidThisMonth") : t("recurring.markPaid")}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
