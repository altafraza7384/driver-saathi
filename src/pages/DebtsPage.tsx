import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatINR } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Plus, ArrowLeft, CreditCard, Trash2 } from "lucide-react";
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
  const [saving, setSaving] = useState(false);

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

    const { error } = await supabase.from("debts").insert({
      user_id: user.id,
      name,
      principal: p,
      interest_rate: r,
      tenure_months: m,
      emi_amount: Math.round(emi * 100) / 100,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Loan added!" });
      setShowAdd(false);
      setName(""); setPrincipal(""); setRate(""); setTenure("");
      fetchDebts();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("debts").delete().eq("id", id);
    fetchDebts();
  };

  const totalLiability = debts.reduce((s, d) => s + Number(d.principal) - Number(d.total_paid), 0);
  const totalEMI = debts.filter(d => d.is_active).reduce((s, d) => s + (Number(d.emi_amount) || 0), 0);

  return (
    <div className="space-y-4 p-4 pt-6">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Debt & EMI</h1>
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
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(debt.id)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Paid: {formatINR(Number(debt.total_paid))}</span>
                      <span>Remaining: {formatINR(remaining)}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    {debt.emi_amount && (
                      <p className="text-xs text-muted-foreground">EMI: {formatINR(Number(debt.emi_amount))}/month</p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
