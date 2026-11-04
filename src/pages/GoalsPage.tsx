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
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowLeft, Target, Trash2, PartyPopper, Pencil } from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Goal = {
  id: string;
  title: string;
  target_amount: number;
  saved_amount: number;
  deadline: string | null;
  is_completed: boolean;
};

export default function GoalsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Home's goal widget and the notification bell read goals via
  // react-query; invalidate both so they refresh on return.
  const invalidateGoalReaders = () => {
    queryClient.invalidateQueries({ queryKey: ["goals_active"] });
    queryClient.invalidateQueries({ queryKey: ["notifications_goals"] });
  };

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddSavings, setShowAddSavings] = useState<string | null>(null);
  const [addAmount, setAddAmount] = useState("");
  const [savingGoalId, setSavingGoalId] = useState<string | null>(null);

  // Add form
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [notifyDate, setNotifyDate] = useState("");
  const [notifyTime, setNotifyTime] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editDeadline, setEditDeadline] = useState("");

  // Form-sheet pattern (Phase 6, presentation only): validation messages
  // are shown directly beneath their field, in addition to the existing
  // toast. Each error slot is always rendered with a reserved height so
  // the footer below it does not move when an error appears. Field
  // values are never cleared on a failed validation.
  const [addErrors, setAddErrors] = useState<{ title?: string; target?: string }>({});
  const [editErrors, setEditErrors] = useState<{ target?: string }>({});
  const [savingsError, setSavingsError] = useState("");

  useEffect(() => {
    if (user) fetchGoals();
  }, [user]);

  const fetchGoals = async () => {
    const { data } = await db.from("goals").select("*").order("created_at", { ascending: false });
    setGoals((data as Goal[]) || []);
    setLoading(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddErrors({});
    if (!user) return;
    // noValidate form: say what is missing instead of doing nothing.
    if (!title.trim()) {
      toast({ title: t("form.checkInput"), description: t("form.nameRequired"), variant: "destructive" });
      setAddErrors({ title: t("form.nameRequired") });
      return;
    }
    setSaving(true);

    const targetAmt = parseFloat(target);
    if (!Number.isFinite(targetAmt) || targetAmt <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setSaving(false);
      setAddErrors({ target: t("form.amountPositive") });
      return;
    }

    const notifyAt = notifyDate && notifyTime ? `${notifyDate}T${notifyTime}:00` : notifyDate ? `${notifyDate}T09:00:00` : null;
    const { error } = await db.from("goals").insert({
      user_id: user.id,
      title,
      target_amount: targetAmt,
      saved_amount: 0,
      is_completed: false,
      deadline: deadline || null,
      notify_at: notifyAt,
    } as any);

    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: t("goal.created") });
      setShowAdd(false);
      setTitle(""); setTarget(""); setDeadline(""); setNotifyDate(""); setNotifyTime("");
      setAddErrors({});
      invalidateGoalReaders();
      fetchGoals();
    }
    setSaving(false);
  };

  const openEdit = (goal: Goal) => {
    setEditGoal(goal);
    setEditTitle(goal.title);
    setEditTarget(String(toAmount(goal.target_amount)));
    setEditDeadline(goal.deadline || "");
    setEditErrors({});
  };

  const handleUpdate = async () => {
    if (!editGoal) return;
    setEditErrors({});
    setSaving(true);
    const newTarget = parseFloat(editTarget);
    if (!Number.isFinite(newTarget) || newTarget <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setSaving(false);
      setEditErrors({ target: t("form.amountPositive") });
      return;
    }
    const isCompleted = toAmount(editGoal.saved_amount) >= newTarget;

    const { error } = await db.from("goals").update({
      title: editTitle,
      target_amount: newTarget,
      deadline: editDeadline || null,
      is_completed: isCompleted,
    }).eq("id", editGoal.id);

    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
    } else {
      toast({ title: t("goal.updated") });
      setEditGoal(null);
      setEditErrors({});
      invalidateGoalReaders();
      fetchGoals();
    }
    setSaving(false);
  };

  const handleAddSavings = async (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal || !addAmount || savingGoalId) return;
    setSavingsError("");
    const amount = parseFloat(addAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: t("form.checkInput"), description: t("form.amountPositive"), variant: "destructive" });
      setSavingsError(t("form.amountPositive"));
      return;
    }
    // Disable while saving: a double-tap used to compute both writes
    // from the same base and lose one addition (audit 2026-10-24).
    setSavingGoalId(goalId);

    const newSaved = toAmount(goal.saved_amount) + amount;
    const isCompleted = newSaved >= toAmount(goal.target_amount);

    const { error } = await db.from("goals").update({
      saved_amount: newSaved,
      is_completed: isCompleted,
    }).eq("id", goalId);

    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
      setSavingGoalId(null);
      return;
    }

    if (isCompleted) {
      toast({ title: t("goal.completedTitle"), description: t("goal.completedDesc", { name: goal.title }) });
    } else {
      toast({ title: t("goal.savingsAdded", { amount: formatINR(parseFloat(addAmount) || 0) }) });
    }

    setSavingGoalId(null);

    setShowAddSavings(null);
    setAddAmount("");
    setSavingsError("");
    invalidateGoalReaders();
    fetchGoals();
  };

  const handleDelete = async (id: string) => {
    const { error } = await db.from("goals").delete().eq("id", id);
    if (error) {
      toast({ title: t("auth.error"), description: friendlyErrorMessage(error), variant: "destructive" });
      return;
    }
    toast({ title: t("goal.deleted") });
    invalidateGoalReaders();
    fetchGoals();
  };

  return (
    <div className="space-y-4 p-4 pt-6">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </button>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("goal.title")}</h1>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> {t("goal.newGoal")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("goal.createGoal")}</DialogTitle></DialogHeader>
            <form noValidate onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="goal-title">{t("goal.goalTitle")}</Label>
                <Input id="goal-title" placeholder="e.g. New Tires" value={title} onChange={(e) => { setTitle(e.target.value); setAddErrors((prev) => ({ ...prev, title: undefined })); }} required aria-describedby="goal-title-error" />
                <p id="goal-title-error" className="min-h-5 text-sm text-destructive">{addErrors.title ?? ""}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="goal-target">{t("goal.targetAmount")}</Label>
                <Input id="goal-target" type="number" placeholder="50000" value={target} onChange={(e) => { setTarget(e.target.value); setAddErrors((prev) => ({ ...prev, target: undefined })); }} min="1" required aria-describedby="goal-target-error" />
                <p id="goal-target-error" className="min-h-5 text-sm text-destructive">{addErrors.target ?? ""}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-deadline">{t("goal.deadline")} ({t("common.optional")})</Label>
                <DatePicker id="goal-deadline" label={t("goal.deadline")} value={deadline} onChange={setDeadline} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="goal-notify-date">{t("reminder.notifyDate")}</Label>
                  <DatePicker id="goal-notify-date" label={t("reminder.notifyDate")} value={notifyDate} onChange={setNotifyDate} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal-notify-time">{t("reminder.notifyTime")}</Label>
                  <TimePicker id="goal-notify-time" label={t("reminder.notifyTime")} value={notifyTime} onChange={setNotifyTime} />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? t("goal.creating") : t("goal.createGoalBtn")}
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : goals.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">{t("goal.noGoals")}</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {goals.map((goal, i) => {
            // saved_amount/target_amount may be missing or string-typed on
            // docs created before defaults were set (Firestore has no column
            // defaults like Supabase) — coerce so nothing renders NaN.
            const savedNum = toAmount(goal.saved_amount);
            const targetNum = toAmount(goal.target_amount);
            const progress = targetNum > 0
              ? clampPercent((savedNum / targetNum) * 100)
              : 0;
            return (
              <motion.div key={goal.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className={goal.is_completed ? "border-success/30 bg-success/5" : ""}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {goal.is_completed ? (
                          <PartyPopper className="h-5 w-5 text-success" />
                        ) : (
                          <Target className="h-5 w-5 text-primary" />
                        )}
                        <div>
                          <p className="font-semibold text-sm">{goal.title}</p>
                          {goal.deadline && (
                            <p className="text-xs text-muted-foreground">
                              By {format(new Date(goal.deadline), "dd MMM yyyy")}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("common.edit")} onClick={() => openEdit(goal)}>
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <ConfirmDelete onConfirm={() => handleDelete(goal.id)} itemName={goal.title}>
                          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("common.delete")}>
                            <Trash2 className="h-4 w-4 text-destructive/80" />
                          </Button>
                        </ConfirmDelete>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Saved: {formatINR(savedNum)}</span>
                      <span>Target: {formatINR(targetNum)}</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs font-medium text-center">{Math.round(progress)}% complete</p>

                    {!goal.is_completed && (
                      <>
                        {showAddSavings === goal.id ? (
                          <div className="space-y-1">
                            <Label htmlFor="goal-add-amount">{t("common.amount")}</Label>
                            <div className="flex gap-2">
                              <Input
                                id="goal-add-amount"
                                type="number"
                                placeholder={t("common.amount")}
                                value={addAmount}
                                onChange={(e) => { setAddAmount(e.target.value); setSavingsError(""); }}
                                min="1"
                                className="flex-1"
                                aria-describedby="goal-add-amount-error"
                              />
                              <Button size="sm" onClick={() => handleAddSavings(goal.id)} disabled={savingGoalId === goal.id}>{savingGoalId === goal.id ? t("common.saving") : t("common.save")}</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setShowAddSavings(null); setAddAmount(""); setSavingsError(""); }}>✕</Button>
                            </div>
                            <p id="goal-add-amount-error" className="min-h-5 text-sm text-destructive">{savingsError}</p>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full" onClick={() => { setShowAddSavings(goal.id); setSavingsError(""); }}>
                            <Plus className="h-4 w-4 mr-1" /> {t("goal.addSavings")}
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
      <Dialog open={!!editGoal} onOpenChange={(open) => !open && setEditGoal(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("goal.editGoal")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="edit-goal-title">{t("goal.goalTitle")}</Label>
              <Input id="edit-goal-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-goal-target">{t("goal.targetAmount")}</Label>
              <Input id="edit-goal-target" type="number" value={editTarget} onChange={(e) => { setEditTarget(e.target.value); setEditErrors((prev) => ({ ...prev, target: undefined })); }} min="1" aria-describedby="edit-goal-target-error" />
              <p id="edit-goal-target-error" className="min-h-5 text-sm text-destructive">{editErrors.target ?? ""}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal-edit-deadline">{t("goal.deadline")} ({t("common.optional")})</Label>
              <DatePicker id="goal-edit-deadline" label={t("goal.deadline")} value={editDeadline} onChange={setEditDeadline} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={handleUpdate} disabled={saving}>
                {saving ? t("common.saving") : t("goal.updateGoal")}
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setEditGoal(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
