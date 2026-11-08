import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { formatINR, toAmount, clampPercent } from "@/lib/currency";
import { friendlyErrorMessage } from "@/lib/errors";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { localToday } from "@/lib/budgets";
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
import { Skeleton } from "@/components/ui/skeleton";

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
  const [loadError, setLoadError] = useState(false);
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
  const [paying, setPaying] = useState(false);

  // Form-sheet pattern (Phase 6, presentation only): validation messages
  // are shown directly beneath their field, in addition to the existing
  // toast. Each error slot is always rendered with a reserved height so
  // the footer below it does not move when an error appears. Field
  // values are never cleared on a failed validation.
  const [addErrors, setAddErrors] = useState<{ name?: string; principal?: string; rate?: string; tenure?: string; customEmi?: string }>({});
  const [editErrors, setEditErrors] = useState<{ principal?: string }>({});
  const [payError, setPayError] = useState("");

  useEffect(() => {
    if (user) fetchDebts();
  }, [user]);

  const fetchDebts = async () => {
    const { data, error } = await db.from("debts").select("*").order("created_at", { ascending: false });
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setDebts((data as Debt[]) || []);
    setLoading(false);
  };

  const retryLoad = () => {
    setLoadError(false);
    setLoading(true);
    fetchDebts();
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddErrors({});
    if (!user) return;
    // noValidate form: say what is missing instead of doing nothing.
    if (!name.trim()) {
      toast({ title: t("form.checkInput"), description: t("form.nameRequired"), variant: "destructive" });
      setAddErrors({ name: t("form.nameRequired") });
      return;
    }
    setSaving(true);

    const p = parseFloat(principal);
    if (!Number.isFinite(p) || p <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setSaving(false);
      setAddErrors({ principal: t("form.amountPositive") });
      return;
    }
    const r = parseFloat(rate) || 0;
    const m = parseInt(tenure) || 12;
    if (r < 0 || r > 100 || m <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.rateTenureInvalid"), variant: "destructive" });
      setSaving(false);
      setAddErrors({ rate: t("form.rateTenureInvalid"), tenure: t("form.rateTenureInvalid") });
      return;
    }
    const calculatedEmi = calculateEMI(p, r, m);
    const parsedCustom = parseFloat(customEmi);
    // A custom EMI must be positive: a negative/zero custom EMI used to
    // be stored and dragged the monthly-EMI total down (audit 2026-10-24).
    if (customEmi && (!Number.isFinite(parsedCustom) || parsedCustom <= 0)) {
      toast({ title: "Error", description: "Please enter a valid custom EMI amount.", variant: "destructive" });
      setSaving(false);
      setAddErrors({ customEmi: "Please enter a valid custom EMI amount." });
      return;
    }
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
      start_date: localToday(),
      notify_at: notifyAt,
    } as any);

    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: t("debt.loanAdded") });
      setShowAdd(false);
      setName(""); setPrincipal(""); setRate(""); setTenure(""); setNotifyDate(""); setNotifyTime(""); setCustomEmi("");
      setAddErrors({});
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
    setEditErrors({});
  };

  const handleUpdate = async () => {
    if (!editDebt) return;
    setEditErrors({});
    setSaving(true);
    const p = parseFloat(editPrincipal);
    if (!Number.isFinite(p) || p <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setSaving(false);
      setEditErrors({ principal: t("form.amountPositive") });
      return;
    }
    const r = parseFloat(editRate) || 0;
    const m = parseInt(editTenure) || 12;
    // Preserve a custom EMI: editing only the loan name used to silently
    // reset a custom EMI back to the calculated value (audit 2026-10-24).
    // Recalculate only when the inputs that determine the EMI changed.
    const inputsChanged =
      p !== toAmount(editDebt.principal) ||
      r !== toAmount(editDebt.interest_rate) ||
      m !== toAmount(editDebt.tenure_months);
    const emi = inputsChanged ? calculateEMI(p, r, m) : toAmount(editDebt.emi_amount);

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
      toast({ title: t("debt.loanUpdated") });
      setEditDebt(null);
      setEditErrors({});
      invalidateDebtReaders();
      fetchDebts();
    }
    setSaving(false);
  };

  const handlePayEMI = async () => {
    if (!payDebtId || !payAmount || !user) return;
    const debt = debts.find(d => d.id === payDebtId);
    if (!debt) return;
    setPayError("");

    const amount = parseFloat(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setPayError(t("form.amountPositive"));
      return;
    }
    // Block overpayment: paying more than the remaining balance used to
    // store a negative "Remaining" (audit 2026-10-24).
    const remaining = toAmount(debt.principal) - toAmount(debt.total_paid);
    if (amount > remaining) {
      toast({ title: "Error", description: `Payment is more than the remaining amount (${formatINR(remaining)}).`, variant: "destructive" });
      setPayError(`Payment is more than the remaining amount (${formatINR(remaining)}).`);
      return;
    }
    setPaying(true);
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
      setPaying(false);
      return;
    }

    // Update debt
    const { error: updateError } = await db.from("debts").update({
      total_paid: newTotalPaid,
      is_active: !isFullyPaid,
    }).eq("id", payDebtId);
    if (updateError) {
      toast({ title: "Error", description: friendlyErrorMessage(updateError), variant: "destructive" });
      setPaying(false);
      return;
    }

    toast({ title: isFullyPaid ? "🎉 Loan fully paid!" : `₹${payAmount} payment recorded!` });
    setPaying(false);
    setPayDebtId(null);
    setPayAmount("");
    setPayError("");
    invalidateDebtReaders();
    fetchDebts();
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from("debts").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: friendlyErrorMessage(error), variant: "destructive" });
      return;
    }
    toast({ title: t("debt.loanDeleted") });
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
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </button>

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold sm:text-2xl">{t("debt.title")}</h1>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> {t("debt.addLoan")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("debt.newLoan")}</DialogTitle></DialogHeader>
            <form noValidate onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="debt-name">{t("debt.loanName")}</Label>
                <Input id="debt-name" placeholder="e.g. Car Loan" value={name} onChange={(e) => { setName(e.target.value); setAddErrors((prev) => ({ ...prev, name: undefined })); }} required aria-describedby="debt-name-error" />
                <p id="debt-name-error" className="min-h-5 text-sm text-destructive">{addErrors.name ?? ""}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="debt-principal">{t("debt.principalAmount")}</Label>
                <Input id="debt-principal" type="number" placeholder="500000" value={principal} onChange={(e) => { setPrincipal(e.target.value); setAddErrors((prev) => ({ ...prev, principal: undefined })); }} min="1" required aria-describedby="debt-principal-error" />
                <p id="debt-principal-error" className="min-h-5 text-sm text-destructive">{addErrors.principal ?? ""}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="debt-rate">{t("debt.interestRate")}</Label>
                  <Input id="debt-rate" type="number" placeholder="10" value={rate} onChange={(e) => { setRate(e.target.value); setAddErrors((prev) => ({ ...prev, rate: undefined })); }} min="0" step="0.1" aria-describedby="debt-rate-error" />
                  <p id="debt-rate-error" className="min-h-5 text-sm text-destructive">{addErrors.rate ?? ""}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="debt-tenure">{t("debt.tenure")}</Label>
                  <Input id="debt-tenure" type="number" placeholder="36" value={tenure} onChange={(e) => { setTenure(e.target.value); setAddErrors((prev) => ({ ...prev, tenure: undefined })); }} min="1" aria-describedby="debt-tenure-error" />
                  <p id="debt-tenure-error" className="min-h-5 text-sm text-destructive">{addErrors.tenure ?? ""}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="debt-notify-date">{t("reminder.notifyDate")}</Label>
                  <DatePicker id="debt-notify-date" label={t("reminder.notifyDate")} value={notifyDate} onChange={setNotifyDate} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="debt-notify-time">{t("reminder.notifyTime")}</Label>
                  <TimePicker id="debt-notify-time" label={t("reminder.notifyTime")} value={notifyTime} onChange={setNotifyTime} />
                </div>
              </div>
              {principal && tenure && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-3 space-y-2">
                    <p className="text-xs text-muted-foreground text-center">{t("debt.estimatedEmi")}</p>
                    <p className="text-xl font-bold text-primary text-center">
                      {formatINR(toAmount(customEmi ? parseFloat(customEmi) : calculateEMI(parseFloat(principal) || 0, parseFloat(rate) || 0, parseInt(tenure) || 12)))}
                    </p>
                    <div className="space-y-1">
                      <Label htmlFor="debt-custom-emi">{t("form.editEmiAmount")}</Label>
                      <Input
                        id="debt-custom-emi"
                        type="number"
                        placeholder={t("form.editEmiAmount")}
                        value={customEmi}
                        onChange={(e) => { setCustomEmi(e.target.value); setAddErrors((prev) => ({ ...prev, customEmi: undefined })); }}
                        className="text-center"
                        min="1"
                        aria-describedby="debt-custom-emi-error"
                      />
                      <p id="debt-custom-emi-error" className="min-h-5 text-sm text-destructive">{addErrors.customEmi ?? ""}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">{t("form.leaveBlankEmi")}</p>
                  </CardContent>
                </Card>
              )}
              <div className="flex gap-2 pt-1">
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? "Saving..." : "Add Loan"}
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-destructive/5 border-destructive/20">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{t("debt.totalOutstanding")}</p>
            {loading ? <Skeleton className="mt-1 h-7 w-24" /> : <p className="text-lg font-bold text-destructive">{formatINR(totalLiability)}</p>}
          </CardContent>
        </Card>
        <Card className="bg-warning/5 border-warning/20">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{t("debt.monthlyEmi")}</p>
            {loading ? <Skeleton className="mt-1 h-7 w-24" /> : <p className="text-lg font-bold text-warning">{formatINR(Math.round(totalEMI))}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Debt List */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium">{t("home.loadError")}</p>
          <button
            className="mt-1 font-medium text-primary underline"
            onClick={retryLoad}
          >
            {t("common.retry")}
          </button>
        </div>
      ) : debts.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">{t("debt.noLoans")}</CardContent></Card>
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
                          <p className="text-xs text-muted-foreground">{toAmount(debt.interest_rate)}% • {t("debt.monthsN", { n: toAmount(debt.tenure_months) })}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("common.edit")} onClick={() => openEdit(debt)}>
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <ConfirmDelete onConfirm={() => handleDelete(debt.id)} itemName={debt.name}>
                          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("common.delete")}>
                            <Trash2 className="h-4 w-4 text-destructive/80" />
                          </Button>
                        </ConfirmDelete>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>{t("home.paid")}: {formatINR(paidAmt)}</span>
                      <span>{t("home.remaining")}: {formatINR(Math.max(0, remaining))}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    {toAmount(debt.emi_amount) > 0 && (
                      <p className="text-xs text-muted-foreground">{t("debt.emiPerMonth", { amount: formatINR(Math.round(toAmount(debt.emi_amount))) })}</p>
                    )}
                    {debt.is_active !== false && (
                      <>
                        {payDebtId === debt.id ? (
                          <div className="space-y-1">
                            <Label htmlFor="debt-pay-amount">{t("debt.paymentAmount")}</Label>
                            <div className="flex gap-2">
                              <Input
                                id="debt-pay-amount"
                                type="number"
                                placeholder={t("debt.paymentAmount")}
                                value={payAmount}
                                onChange={(e) => { setPayAmount(e.target.value); setPayError(""); }}
                                min="1"
                                className="flex-1"
                                aria-describedby="debt-pay-amount-error"
                              />
                              <Button size="sm" onClick={handlePayEMI} disabled={paying}>{paying ? t("common.saving") : t("common.pay")}</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setPayDebtId(null); setPayAmount(""); setPayError(""); }}>✕</Button>
                            </div>
                            <p id="debt-pay-amount-error" className="min-h-5 text-sm text-destructive">{payError}</p>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full" onClick={() => { setPayDebtId(debt.id); setPayAmount(String(debt.emi_amount || "")); setPayError(""); }}>
                            <Banknote className="h-4 w-4 mr-1" /> {t("debt.recordPayment")}
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
          <DialogHeader><DialogTitle>{t("debt.editLoan")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-debt-name">{t("debt.loanName")}</Label>
              <Input id="edit-debt-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-debt-principal">{t("debt.principalAmount")}</Label>
              <Input id="edit-debt-principal" type="number" value={editPrincipal} onChange={(e) => { setEditPrincipal(e.target.value); setEditErrors((prev) => ({ ...prev, principal: undefined })); }} min="1" aria-describedby="edit-debt-principal-error" />
              <p id="edit-debt-principal-error" className="min-h-5 text-sm text-destructive">{editErrors.principal ?? ""}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-debt-rate">{t("debt.interestRate")}</Label>
                <Input id="edit-debt-rate" type="number" value={editRate} onChange={(e) => setEditRate(e.target.value)} min="0" step="0.1" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-debt-tenure">{t("debt.tenure")}</Label>
                <Input id="edit-debt-tenure" type="number" value={editTenure} onChange={(e) => setEditTenure(e.target.value)} min="1" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={handleUpdate} disabled={saving}>
                {saving ? t("common.saving") : t("debt.updateLoan")}
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setEditDebt(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
