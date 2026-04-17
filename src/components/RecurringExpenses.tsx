import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatINR } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
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
  { value: "rent", label: "Room Rent" },
  { value: "electricity", label: "Electricity" },
  { value: "water", label: "Water" },
  { value: "internet", label: "Internet" },
  { value: "mobile", label: "Mobile/Recharge" },
  { value: "gas", label: "Gas/LPG" },
  { value: "subscription", label: "Subscription" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
];

function nextNotifyDate(dueDay: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), dueDay, 9, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setMonth(target.getMonth() + 1);
  }
  return target.toISOString();
}

export default function RecurringExpenses() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

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
    const { data } = await supabase
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
    setAmount(String(it.amount));
    setDueDay(String(it.due_day));
    setNote(it.note || "");
    setShowAdd(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const payload = {
      user_id: user.id,
      name,
      category,
      amount: parseFloat(amount),
      due_day: Math.min(31, Math.max(1, parseInt(dueDay) || 1)),
      notify_at: nextNotifyDate(parseInt(dueDay) || 1),
      note: note || null,
    };

    const { error } = editing
      ? await supabase.from("recurring_expenses").update(payload).eq("id", editing.id)
      : await supabase.from("recurring_expenses").insert(payload);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editing ? "Expense updated!" : "Expense added!" });
      setShowAdd(false);
      resetForm();
      fetchItems();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("recurring_expenses").delete().eq("id", id);
    toast({ title: "Expense removed" });
    fetchItems();
  };

  const handleMarkPaid = async (it: RecurringExpense) => {
    if (!user) return;
    await supabase.from("recurring_expense_payments").insert({
      user_id: user.id,
      expense_id: it.id,
      amount: it.amount,
    });
    // also create a regular transaction record so it shows in finance
    await supabase.from("transactions").insert({
      user_id: user.id,
      type: "expense",
      category: it.category,
      amount: it.amount,
      description: it.name,
    });
    await supabase
      .from("recurring_expenses")
      .update({ last_paid_date: new Date().toISOString().slice(0, 10) })
      .eq("id", it.id);
    toast({ title: `✅ Paid ${formatINR(it.amount)}` });
    fetchItems();
  };

  const totalMonthly = items
    .filter((i) => i.is_active)
    .reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 pt-2">
        <div>
          <h2 className="text-base font-bold sm:text-lg">Monthly Bills</h2>
          <p className="text-xs text-muted-foreground">Rent, utilities & subscriptions</p>
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
              <Plus className="h-4 w-4" /> Add Bill
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Bill" : "Add Recurring Bill"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="e.g. Room Rent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Amount (₹)</Label>
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
                <Label>Due Day of Month (1-31)</Label>
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
                  You'll get a notification every month on this day at 9 AM.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Note (optional)</Label>
                <Input
                  placeholder="Landlord name, account no, etc."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Saving..." : editing ? "Update Bill" : "Add Bill"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {items.length > 0 && (
        <Card className="bg-accent/30 border-accent/40">
          <CardContent className="p-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Total Monthly Bills</span>
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
                    <span className="text-base font-bold">{formatINR(Number(it.amount))}</span>
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
                  >
                    <Banknote className="h-3.5 w-3.5 mr-1" /> Mark Paid This Month
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
