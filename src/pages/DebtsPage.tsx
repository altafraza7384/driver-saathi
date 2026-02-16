import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatINR } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Plus, ArrowLeft, CreditCard, Trash2, Pencil, Banknote } from "lucide-react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
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
    const { data } = await supabase.from("debts").select("*").order("created_at", { ascending: false });
    setDebts((data as Debt[]) || []);
    setLoading(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    const p = parseFloat(principal);
    const r = parseFloat(rate) || 0;
    const m = parseInt(tenure) || 12;
    const emi = calculateEMI(p, r, m);

    const notifyAt = notifyDate && notifyTime ? `${notifyDate}T${notifyTime}:00` : notifyDate ? `${notifyDate}T09:00:00` : null;
    const { error } = await supabase.from("debts").insert({
      user_id: user.id,
      name,
      principal: p,
      interest_rate: r,
      tenure_months: m,
      emi_amount: Math.round(emi * 100) / 100,
      notify_at: notifyAt,
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Loan added!" });
      setShowAdd(false);
      setName(""); setPrincipal(""); setRate(""); setTenure(""); setNotifyDate(""); setNotifyTime("");
      fetchDebts();
    }
    setSaving(false);
  };

  const openEdit = (debt: Debt) => {
    setEditDebt(debt);
    setEditName(debt.name);
    setEditPrincipal(String(debt.principal));
    setEditRate(String(debt.interest_rate));
    setEditTenure(String(debt.tenure_months));
  };

  const handleUpdate = async () => {
    if (!editDebt) return;
    setSaving(true);
    const p = parseFloat(editPrincipal);
    const r = parseFloat(editRate) || 0;
    const m = parseInt(editTenure) || 12;
    const emi = calculateEMI(p, r, m);

    const { error } = await supabase.from("debts").update({
      name: editName,
      principal: p,
      interest_rate: r,
      tenure_months: m,
      emi_amount: Math.round(emi * 100) / 100,
    }).eq("id", editDebt.id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Loan updated!" });
      setEditDebt(null);
      fetchDebts();
    }
    setSaving(false);
  };

  const handlePayEMI = async () => {
    if (!payDebtId || !payAmount || !user) return;
    const debt = debts.find(d => d.id === payDebtId);
    if (!debt) return;

    const amount = parseFloat(payAmount);
    const newTotalPaid = Number(debt.total_paid) + amount;
    const isFullyPaid = newTotalPaid >= Number(debt.principal);

    // Record payment
    await supabase.from("debt_payments").insert({
      user_id: user.id,
      debt_id: payDebtId,
      amount,
    });

    // Update debt
    await supabase.from("debts").update({
      total_paid: newTotalPaid,
      is_active: !isFullyPaid,
    }).eq("id", payDebtId);

    toast({ title: isFullyPaid ? "🎉 Loan fully paid!" : `₹${payAmount} payment recorded!` });
    setPayDebtId(null);
    setPayAmount("");
    fetchDebts();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("debts").delete().eq("id", id);
    toast({ title: "Loan deleted" });
    fetchDebts();
  };

  const totalLiability = debts.reduce((s, d) => s + Number(d.principal) - Number(d.total_paid), 0);
  const totalEMI = debts.filter(d => d.is_active).reduce((s, d) => s + (Number(d.emi_amount) || 0), 0);

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
                  <Label>Notify Date</Label>
                  <Input type="date" value={notifyDate} onChange={(e) => setNotifyDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Notify Time</Label>
                  <Input type="time" value={notifyTime} onChange={(e) => setNotifyTime(e.target.value)} />
                </div>
              </div>
              {principal && tenure && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-3 text-center">
                    <p className="text-xs text-muted-foreground">Estimated Monthly EMI</p>
                    <p className="text-xl font-bold text-primary">
                      {formatINR(calculateEMI(parseFloat(principal) || 0, parseFloat(rate) || 0, parseInt(tenure) || 12))}
                    </p>
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
            const remaining = Number(debt.principal) - Number(debt.total_paid);
            const progress = Number(debt.principal) > 0 ? (Number(debt.total_paid) / Number(debt.principal)) * 100 : 0;
            return (
              <motion.div key={debt.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-semibold text-sm">{debt.name}</p>
                          <p className="text-xs text-muted-foreground">{debt.interest_rate}% • {debt.tenure_months} months</p>
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
                      <span>Paid: {formatINR(Number(debt.total_paid))}</span>
                      <span>Remaining: {formatINR(remaining)}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    {debt.emi_amount && (
                      <p className="text-xs text-muted-foreground">EMI: {formatINR(Number(debt.emi_amount))}/month</p>
                    )}
                    {debt.is_active && (
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


