import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { formatINR, toAmount, clampPercent } from "@/lib/currency";
import { friendlyErrorMessage } from "@/lib/errors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowLeft, CreditCard, Trash2, Pencil, Banknote } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import RecurringExpenses from "@/components/RecurringExpenses";

type Debt = {
  id: string;
  name: string;
  principal: number;
  interest_rate: number;
  tenure_months: number;
  emi_amount: number | null;
  total_paid: number;
  start_date: string;
  is_active: boolean;
};

function calculateEMI(principal: number, rate: number, months: number): number {
  if (rate === 0) return principal / months;
  const monthlyRate = rate / 12 / 100;
  return (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
}

export default function DebtsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Home's debt widget and the notification bell read debts via
  // react-query; invalidate both so they refresh on return.
  const invalidateDebtReaders = () => {
    queryClient.invalidateQueries({ queryKey: ["debts_active"] });
    queryClient.invalidateQueries({ queryKey: ["notifications_debts"] });
  };

  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Add form state
  const [name, setName] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [tenure, setTenure] = useState("");
  const [notifyDate, setNotifyDate] = useState("");
  const [notifyTime, setNotifyTime] = useState("");
  const [customEmi, setCustomEmi] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editDebt, setEditDebt] = useState<Debt | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrincipal, setEditPrincipal] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editTenure, setEditTenure] = useState("");

  // Pay EMI state
  const [payDebtId, setPayDebtId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");

  useEffect(() => {
    if (user) fetchDebts();
  }, [user]);

  const fetchDebts = async () => {
    const { data } = await db.from("debts").select("*").order("created_at", { ascending: false });
    setDebts((data as Debt[]) || []);
    setLoading(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const p = parseFloat(principal);
    if (!Number.isFinite(p) || p <= 0) {
      toast({ title: "Error", description: "Please enter a valid principal amount.", variant: "destructive" });
      setSaving(false);
      return;
    }
    const r = parseFloat(rate) || 0;
    const m = parseInt(tenure) || 12;
    const calculatedEmi = calculateEMI(p, r, m);
    const parsedCustom = parseFloat(customEmi);
    const finalEmi = customEmi && Number.isFinite(parsedCustom) ? parsedCustom : calculatedEmi;

    const notifyAt = notifyDate && notifyTime ? `${notifyDate}T${notifyTime}:00` : notifyDate ? `${notifyDate}T09:00:00` : null;
    const { error } = await db.from("debts").insert({
      user_id: user.id,
      name,
      principal: p,
      interest_rate: r,
      tenure_months: m,
      emi_amount: Math.round(finalEmi * 100) / 100,
      // Supabase used to default these columns; Firestore stores only what
      // is sent, and every Paid/Remaining/Home computation reads them —
      // leaving them out is what produced "₹NaN" and invisible loans.
      total_paid: 0,
      is_active: true,
      start_date: new Date().toISOString().split("T")[0],
      notify_at: notifyAt,
    } as any);

    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: "Loan added!" });
      setShowAdd(false);
      setName(""); setPrincipal(""); setRate(""); setTenure(""); setNotifyDate(""); setNotifyTime(""); setCustomEmi("");
      invalidateDebtReaders();
      fetchDebts();
    }
    setSaving(false);
  };

  const openEdit = (debt: Debt) => {
    setEditDebt(debt);
    setEditName(debt.name);
    setEditPrincipal(String(toAmount(debt.principal)));
    setEditRate(String(toAmount(debt.interest_rate)));
    setEditTenure(String(toAmount(debt.tenure_months)));
  };

  const handleUpdate = async () => {
    if (!editDebt) return;
    setSaving(true);
    const p = parseFloat(editPrincipal);
    if (!Number.isFinite(p) || p <= 0) {
      toast({ title: "Error", description: "Please enter a valid principal amount.", variant: "destructive" });
      setSaving(false);
      return;
    }
    const r = parseFloat(editRate) || 0;
    const m = parseInt(editTenure) || 12;
    const emi = calculateEMI(p, r, m);

    const { error } = await db.from("debts").update({
      name: editName,
      principal: p,
      interest_rate: r,
      tenure_months: m,
      emi_amount: Math.round(emi * 100) / 100,
    }).eq("id", editDebt.id);

    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: "Loan updated!" });
      setEditDebt(null);
      invalidateDebtReaders();
      fetchDebts();
    }
    setSaving(false);
  };

  const handlePayEMI = async () => {
    if (!payDebtId || !payAmount || !user) return;
    const debt = debts.find(d => d.id === payDebtId);
    if (!debt) return;

    const amount = parseFloat(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Error", description: "Please enter a valid payment amount.", variant: "destructive" });
      return;
    }
    const newTotalPaid = toAmount(debt.total_paid) + amount;
    const isFullyPaid = newTotalPaid >= toAmount(debt.principal);

    // Record payment
    const { error: paymentError } = await db.from("debt_payments").insert({
      user_id: user.id,
      debt_id: payDebtId,
      amount,
    });
    if (paymentError) {
      toast({ title: "Error", description: friendlyErrorMessage(paymentError), variant: "destructive" });
      return;
    }

    // Update debt
    const { error: updateError } = await db.from("debts").update({
      total_paid: newTotalPaid,
      is_active: !isFullyPaid,
    }).eq("id", payDebtId);
    if (updateError) {
      toast({ title: "Error", description: friendlyErrorMessage(updateError), variant: "destructive" });
      return;
    }

    toast({ title: isFullyPaid ? "🎉 Loan fully paid!" : `₹${payAmount} payment recorded!` });
    setPayDebtId(null);
    setPayAmount("");
    invalidateDebtReaders();
    fetchDebts();
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from("debts").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
      return;
    }
    toast({ title: "Loan deleted" });
    invalidateDebtReaders();
    fetchDebts();
  };

  const totalLiability = debts.reduce((s, d) => s + toAmount(d.principal) - toAmount(d.total_paid), 0);
  // Docs created before is_active was written at creation have no flag at
  // all; Supabase's column default made them active, so only an explicit
  // false means inactive.
  const totalEMI = debts.filter(d => d.is_active !== false).reduce((s, d) => s + toAmount(d.emi_amount), 0);

  return (
    <div className="space-y-4 p-4 pt-6">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold sm:text-2xl">Debt & EMI</h1>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add Loan</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New Loan</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-2">
                <Label>Loan Name</Label>
                <Input placeholder="e.g. Car Loan" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Principal Amount (₹)</Label>
                <Input type="number" placeholder="500000" value={principal} onChange={(e) => setPrincipal(e.target.value)} min="1" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Interest Rate (%)</Label>
                  <Input type="number" placeholder="10" value={rate} onChange={(e) => setRate(e.target.value)} min="0" step="0.1" />
                </div>
                <div className="space-y-2">
                  <Label>Tenure (months)</Label>
                  <Input type="number" placeholder="36" value={tenure} onChange={(e) => setTenure(e.target.value)} min="1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="debt-notify-date">Notify Date</Label>
                  <DatePicker id="debt-notify-date" label="Notify Date" value={notifyDate} onChange={setNotifyDate} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="debt-notify-time">Notify Time</Label>
                  <TimePicker id="debt-notify-time" label="Notify Time" value={notifyTime} onChange={setNotifyTime} />
                </div>
              </div>
              {principal && tenure && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-3 space-y-2">
                    <p className="text-xs text-muted-foreground text-center">Estimated Monthly EMI</p>
                    <p className="text-xl font-bold text-primary text-center">
                      {formatINR(toAmount(customEmi ? parseFloat(customEmi) : calculateEMI(parseFloat(principal) || 0, parseFloat(rate) || 0, parseInt(tenure) || 12)))}
                    </p>
                    <Input
                      type="number"
                      placeholder="Edit EMI amount"
                      value={customEmi}
                      onChange={(e) => setCustomEmi(e.target.value)}
                      className="text-center"
                      min="1"
                    />
                    <p className="text-[10px] text-muted-foreground text-center">Leave blank to use calculated EMI</p>
                  </CardContent>
                </Card>
              )}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Saving..." : "Add Loan"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Outstanding</p>
            <p className="text-lg font-bold text-destructive">{formatINR(totalLiability)}</p>
          </CardContent>
        </Card>
        <Card className="bg-warning/5 border-warning/20">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Monthly EMI</p>
            <p className="text-lg font-bold text-warning">{formatINR(totalEMI)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Debt List */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : debts.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No loans added yet</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {debts.map((debt, i) => {
            // Docs created before creation-time defaults existed can lack
            // total_paid/principal entirely — coerce so nothing renders NaN.
            const principalAmt = toAmount(debt.principal);
            const paidAmt = toAmount(debt.total_paid);
            const remaining = principalAmt - paidAmt;
            const progress = principalAmt > 0 ? clampPercent((paidAmt / principalAmt) * 100) : 0;
            return (
              <motion.div key={debt.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-semibold text-sm">{debt.name}</p>
                          <p className="text-xs text-muted-foreground">{toAmount(debt.interest_rate)}% • {toAmount(debt.tenure_months)} months</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(debt)}>
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(debt.id)}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Paid: {formatINR(paidAmt)}</span>
                      <span>Remaining: {formatINR(remaining)}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    {toAmount(debt.emi_amount) > 0 && (
                      <p className="text-xs text-muted-foreground">EMI: {formatINR(toAmount(debt.emi_amount))}/month</p>
                    )}
                    {debt.is_active !== false && (
                      <>
                        {payDebtId === debt.id ? (
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              placeholder="Payment amount"
                              value={payAmount}
                              onChange={(e) => setPayAmount(e.target.value)}
                              min="1"
                              className="flex-1"
                            />
                            <Button size="sm" onClick={handlePayEMI}>Pay</Button>
                            <Button size="sm" variant="ghost" onClick={() => { setPayDebtId(null); setPayAmount(""); }}>✕</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full" onClick={() => { setPayDebtId(debt.id); setPayAmount(String(debt.emi_amount || "")); }}>
                            <Banknote className="h-4 w-4 mr-1" /> Record Payment
                          </Button>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Monthly Recurring Bills (Rent, Utilities, Subscriptions) */}
      <div className="pt-4 border-t">
        <RecurringExpenses />
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editDebt} onOpenChange={(open) => !open && setEditDebt(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Loan</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Loan Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Principal Amount (₹)</Label>
              <Input type="number" value={editPrincipal} onChange={(e) => setEditPrincipal(e.target.value)} min="1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Interest Rate (%)</Label>
                <Input type="number" value={editRate} onChange={(e) => setEditRate(e.target.value)} min="0" step="0.1" />
              </div>
              <div className="space-y-2">
                <Label>Tenure (months)</Label>
                <Input type="number" value={editTenure} onChange={(e) => setEditTenure(e.target.value)} min="1" />
              </div>
            </div>
            <Button className="w-full" onClick={handleUpdate} disabled={saving}>
              {saving ? "Saving..." : "Update Loan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


