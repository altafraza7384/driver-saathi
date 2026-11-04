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
  const [showAdd, setShowAdd] = useState(false);
  const [loanName, setLoanName] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [tenure, setTenure] = useState("");
  const [startDate, setStartDate] = useState(localToday());
  const [notifyDate, setNotifyDate] = useState("");
  const [notifyTime, setNotifyTime] = useState("");
  const [customEmi, setCustomEmi] = useState("");
  const [saving, setSaving] = useState(false);
  const [editDebt, setEditDebt] = useState<Debt | null>(null);
  const [editPrincipal, setEditPrincipal] = useState("");
  const [editRate, setEditRate] = useState("");
  const [editTenure, setEditTenure] = useState("");
  const [payDebtId, setPayDebtId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);
  // Form-sheet pattern (Phase 6, presentation only): validation messages
  // are shown directly beneath their field, in addition to the existing
  // toast. Each error slot is always rendered with a reserved height so
  // the footer below it does not move when an error appears. Field
  // values are never cleared on a failed validation.
  const [addErrors, setAddErrors] = useState<{ loanName?: string; principal?: string; rate?: string; tenure?: string; customEmi?: string }>({});
  const [editErrors, setEditErrors] = useState<{ principal?: string }>({});
  const [payError, setPayError] = useState("");

  const loadDebts = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await db
      .from("debts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setDebts(data);
    setLoading(false);
  };

  useEffect(() => {
    loadDebts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const totalLiability = debts.reduce((s, d) => s + toAmount(d.principal) - toAmount(d.total_paid), 0);
  const totalEMI = debts
    .filter((d) => d.is_active !== false)
    .reduce((s, d) => s + toAmount(d.emi_amount), 0);
  const paidPercent = totalLiability > 0 ? clampPercent(((totalLiability - totalLiability) / totalLiability) * 100) : 0;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddErrors({});
    if (!loanName.trim()) {
      toast({ title: t("form.checkInput"), description: t("form.nameRequired"), variant: "destructive" });
      setAddErrors({ loanName: t("form.nameRequired") });
      return;
    }
    if (!principal || parseFloat(principal) <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setAddErrors({ principal: t("form.amountPositive") });
      return;
    }
    if (!rate || !tenure || parseFloat(rate) < 0 || parseFloat(rate) > 60 || parseInt(tenure) < 1 || parseInt(tenure) > 360) {
      toast({ title: t("form.checkInput"), description: t("form.rateTenureInvalid"), variant: "destructive" });
      setAddErrors({ rate: t("form.rateTenureInvalid"), tenure: t("form.rateTenureInvalid") });
      return;
    }
    if (customEmi && parseFloat(customEmi) <= 0) {
      toast({ title: "Error", description: "Please enter a valid custom EMI amount.", variant: "destructive" });
      setAddErrors({ customEmi: "Please enter a valid custom EMI amount." });
      return;
    }
    setSaving(true);
    const emiAmount = customEmi
      ? parseFloat(customEmi)
      : calculateEMI(parseFloat(principal), parseFloat(rate), parseInt(tenure));
    const notifyAt = notifyDate && notifyTime ? `${notifyDate}T${notifyTime}:00` : notifyDate ? `${notifyDate}T09:00:00` : null;
    const { error } = await db.from("debts").insert({
      user_id: user?.id,
      name: loanName.trim(),
      principal: parseFloat(principal),
      interest_rate: parseFloat(rate),
      tenure_months: parseInt(tenure),
      emi_amount: emiAmount,
      total_paid: 0,
      start_date: startDate,
      notify_at: notifyAt,
      is_active: true,
    });
    setSaving(false);
    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: t("debt.added") });
      setShowAdd(false);
      setLoanName("");
      setPrincipal("");
      setRate("");
      setTenure("");
      setNotifyDate("");
      setNotifyTime("");
      setCustomEmi("");
      setAddErrors({});
      loadDebts();
      invalidateDebtReaders();
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditErrors({});
    if (!editDebt) return;
    if (!editPrincipal || parseFloat(editPrincipal) <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setEditErrors({ principal: t("form.amountPositive") });
      return;
    }
    const emiAmount = editDebt.emi_amount
      ? parseFloat(editPrincipal) / parseFloat(editDebt.principal as unknown as string) * toAmount(editDebt.emi_amount)
      : calculateEMI(parseFloat(editPrincipal), parseFloat(editRate), parseInt(editTenure));
    const { error } = await db
      .from("debts")
      .update({
        principal: parseFloat(editPrincipal),
        interest_rate: parseFloat(editRate),
        tenure_months: parseInt(editTenure),
        emi_amount: emiAmount,
      })
      .eq("id", editDebt.id);
    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: t("debt.updated") });
      setEditDebt(null);
      setEditErrors({});
      loadDebts();
      invalidateDebtReaders();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from("debts").delete().eq("id", id);
    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: t("debt.deleted") });
      loadDebts();
      invalidateDebtReaders();
    }
  };

  const handlePayEMI = async (debt: Debt) => {
    setPayError("");
    const amount = parseFloat(payAmount);
    if (!payAmount || amount <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setPayError(t("form.amountPositive"));
      return;
    }
    const remaining = toAmount(debt.principal) - toAmount(debt.total_paid);
    if (amount > remaining) {
      toast({ title: "Error", description: `Payment is more than the remaining amount (${formatINR(remaining)}).`, variant: "destructive" });
      setPayError(`Payment is more than the remaining amount (${formatINR(remaining)}).`);
      return;
    }
    setPaying(true);
    const newPaid = toAmount(debt.total_paid) + amount;
    const isFullyPaid = newPaid >= toAmount(debt.principal);
    const { error } = await db
      .from("debts")
      .update({
        total_paid: newPaid,
        is_active: !isFullyPaid,
      })
      .eq("id", debt.id);
    setPaying(false);
    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: t("debt.paymentRecorded") });
      setPayDebtId(null);
      setPayAmount("");
      setPayError("");
      loadDebts();
      invalidateDebtReaders();
    }
  };

  const handlePayClick = (debt: Debt) => {
    setPayDebtId(debt.id);
    setPayAmount("");
    setPayError("");
  };

  const activeDebts = debts.filter((d) => d.is_active !== false);

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/home")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">{t("debt.title")}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("debt.totalLiability")}</p>
            <p className="text-xl font-bold">{formatINR(totalLiability)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{t("debt.totalEMI")}</p>
            <p className="text-xl font-bold">{formatINR(totalEMI)}</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogTrigger asChild>
          <Button className="w-full">
            <Plus className="h-4 w-4 mr-2" /> {t("debt.addDebt")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("debt.addDebt")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="debt-name">{t("debt.lenderName")}</Label>
              <Input id="debt-name" placeholder={t("debt.lenderName")} value={loanName} onChange={(e) => { setLoanName(e.target.value); setAddErrors((prev) => ({ ...prev, loanName: undefined })); }} aria-describedby="debt-name-error" />
              <p id="debt-name-error" className="min-h-5 text-sm text-destructive">{addErrors.loanName ?? ""}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="debt-principal">{t("debt.principal")}</Label>
              <Input id="debt-principal" type="number" placeholder="100000" value={principal} onChange={(e) => { setPrincipal(e.target.value); setAddErrors((prev) => ({ ...prev, principal: undefined })); }} aria-describedby="debt-principal-error" />
              <p id="debt-principal-error" className="min-h-5 text-sm text-destructive">{addErrors.principal ?? ""}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="debt-rate">{t("debt.interestRate")}</Label>
                <Input id="debt-rate" type="number" placeholder="12" value={rate} onChange={(e) => { setRate(e.target.value); setAddErrors((prev) => ({ ...prev, rate: undefined })); }} aria-describedby="debt-rate-error" />
                <p id="debt-rate-error" className="min-h-5 text-sm text-destructive">{addErrors.rate ?? ""}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="debt-tenure">{t("debt.tenure")}</Label>
                <Input id="debt-tenure" type="number" placeholder="12" value={tenure} onChange={(e) => { setTenure(e.target.value); setAddErrors((prev) => ({ ...prev, tenure: undefined })); }} aria-describedby="debt-tenure-error" />
                <p id="debt-tenure-error" className="min-h-5 text-sm text-destructive">{addErrors.tenure ?? ""}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="debt-start-date">{t("debt.startDate")}</Label>
              <DatePicker id="debt-start-date" label={t("debt.startDate")} value={startDate} onChange={setStartDate} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="debt-reminder-time">{t("debt.reminderTime")}</Label>
              <TimePicker id="debt-reminder-time" label={t("debt.reminderTime")} value={notifyTime} onChange={setNotifyTime} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="debt-notify-date">{t("debt.reminderDate")}</Label>
              <DatePicker id="debt-notify-date" label={t("debt.reminderDate")} value={notifyDate} onChange={setNotifyDate} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="debt-custom-emi">{t("form.editEmiAmount")}</Label>
              <Input id="debt-custom-emi" type="number" placeholder={t("form.editEmiAmount")} value={customEmi} onChange={(e) => { setCustomEmi(e.target.value); setAddErrors((prev) => ({ ...prev, customEmi: undefined })); }} aria-describedby="debt-custom-emi-error" />
              <p id="debt-custom-emi-error" className="min-h-5 text-sm text-destructive">{addErrors.customEmi ?? ""}</p>
            </div>
            <p className="text-sm font-medium">Estimated EMI: {formatINR(toAmount(customEmi ? parseFloat(customEmi) : calculateEMI(parseFloat(principal) || 0, parseFloat(rate) || 0, parseInt(tenure) || 12)))}</p>
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1" disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button>
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>{t("common.cancel")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editDebt} onOpenChange={(open) => !open && setEditDebt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("debt.editDebt")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-debt-name">{t("debt.lenderName")}</Label>
              <Input id="edit-debt-name" placeholder={t("debt.lenderName")} value={editDebt?.name || ""} disabled />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-debt-principal">{t("debt.principal")}</Label>
              <Input id="edit-debt-principal" type="number" placeholder="100000" value={editPrincipal} onChange={(e) => { setEditPrincipal(e.target.value); setEditErrors((prev) => ({ ...prev, principal: undefined })); }} aria-describedby="edit-debt-principal-error" />
              <p id="edit-debt-principal-error" className="min-h-5 text-sm text-destructive">{editErrors.principal ?? ""}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-debt-rate">{t("debt.interestRate")}</Label>
                <Input id="edit-debt-rate" type="number" placeholder="12" value={editRate} onChange={(e) => setEditRate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-debt-tenure">{t("debt.tenure")}</Label>
                <Input id="edit-debt-tenure" type="number" placeholder="12" value={editTenure} onChange={(e) => setEditTenure(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1">{t("common.update")}</Button>
              <Button type="button" variant="outline" className="flex-1" onClick={() => setEditDebt(null)}>{t("common.cancel")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : debts.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            {t("debt.noDebts")}
          </CardContent>
        </Card>
      ) : (
        debts.map((debt) => {
          const remaining = toAmount(debt.principal) - toAmount(debt.total_paid);
          const paidPercent = clampPercent((toAmount(debt.total_paid) / toAmount(debt.principal)) * 100);
          const isPaid = remaining <= 0;
          return (
            <motion.div key={debt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{debt.name}</p>
                      <p className="text-xs text-muted-foreground">{t("debt.monthsN", { count: debt.tenure_months })} • {debt.start_date}</p>
                      <p className="text-xs text-muted-foreground">{t("debt.emiPerMonth", { amount: formatINR(Math.round(toAmount(debt.emi_amount))) })}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditDebt(debt); setEditPrincipal(String(debt.principal)); setEditRate(String(debt.interest_rate)); setEditTenure(String(debt.tenure_months)); setEditErrors({}); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <ConfirmDelete onConfirm={() => handleDelete(debt.id)}>
                        <Button variant="ghost" size="icon">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </ConfirmDelete>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{formatINR(remaining)}</span>
                      <span>{formatINR(debt.principal)}</span>
                    </div>
                    <Progress value={paidPercent} />
                    <p className="text-xs text-muted-foreground">{isPaid ? t("debt.paidOff") : t("debt.remaining", { amount: formatINR(remaining) })}</p>
                  </div>
                  {debt.is_active !== false && (
                    <div className="space-y-1">
                      <Label htmlFor="debt-pay-amount">{t("common.amount")}</Label>
                      <div className="flex gap-2">
                        <Input id="debt-pay-amount" type="number" placeholder={t("debt.payAmount")} value={payDebtId === debt.id ? payAmount : ""} onChange={(e) => { setPayDebtId(debt.id); setPayAmount(e.target.value); setPayError(""); }} aria-describedby="debt-pay-amount-error" />
                        <Button onClick={() => handlePayEMI(debt)} disabled={paying}>{paying ? t("common.saving") : t("debt.payEMI")}</Button>
                        <Button variant="outline" onClick={() => { setPayDebtId(null); setPayAmount(""); setPayError(""); }}>X</Button>
                      </div>
                      <p id="debt-pay-amount-error" className="min-h-5 text-sm text-destructive">{payDebtId === debt.id ? payError : ""}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })
      )}
      <RecurringExpenses />
    </div>
  );
}
