import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Flame, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { localToday } from "@/lib/budgets";
import { computeStreak, isHabitDone, planHabitToggle } from "@/lib/routine";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDelete } from "@/components/ConfirmDelete";

/** Seeded on first open (user's stated routine, 2026-11-21). Stored as
 *  ordinary habit rows, so he can rename or remove them like any other. */
// Generic starter habits only - the app is for every driver, so defaults
// carry no religious, personal or schedule-specific content. Drivers edit
// or replace these freely; nothing here is prescriptive.
const DEFAULT_HABITS = ["Khana time par khaya", "Kaafi paani piya", "Gaadi saaf aur check ki"];

export default function HabitsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = localToday();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const { data: habits = [], isLoading } = useQuery({
    queryKey: ["habits"],
    queryFn: async () => {
      const { data, error } = await db.from("habits").select("*").eq("active", true).order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // Streaks need history, not just today: 90 days of logs is small and
  // covers any realistic streak view.
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;

  const { data: logs = [] } = useQuery({
    queryKey: ["habit_logs", sinceKey],
    queryFn: async () => {
      const { data, error } = await db.from("habit_logs").select("*").gte("date", sinceKey);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // Seed defaults once, only when the user has no habits at all.
  const seedMutation = useMutation({
    mutationFn: async () => {
      const rows = DEFAULT_HABITS.map((habitName, i) => ({ user_id: user!.id, name: habitName, sort_order: i + 1, active: true }));
      const { error } = await db.from("habits").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["habits"] }),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("habits").insert({ user_id: user!.id, name: name.trim(), sort_order: habits.length + 1, active: true });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
      setOpen(false);
      setName("");
      toast.success(t("habits.saved"));
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ habitId, done }: { habitId: string; done: boolean }) => {
      // Deterministic doc id per habit+date (see habitLogId): a second
      // create overwrites the same doc instead of duplicating it, so two
      // rapid taps can no longer leave two completed logs behind. The
      // deleteIds sweep removes any legacy duplicates from the old race.
      const plan = planHabitToggle(logs as any[], habitId, today, done);
      if (plan.writeId) {
        const { error } = await db
          .from("habit_logs")
          .insert({ id: plan.writeId, user_id: user!.id, habit_id: habitId, date: today, done });
        if (error) throw error;
      }
      for (const id of plan.deleteIds) {
        const { error } = await db.from("habit_logs").delete().eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["habit_logs"] }),
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: logError } = await db.from("habit_logs").delete().eq("habit_id", id);
      if (logError) throw logError;
      const { error } = await db.from("habits").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habits"] });
      queryClient.invalidateQueries({ queryKey: ["habit_logs"] });
      toast.success(t("confirm.deleted"));
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const isDone = (habitId: string) => isHabitDone(logs as any[], habitId, today);
  const streakFor = (habitId: string) =>
    computeStreak((logs as any[]).filter((l) => l.habit_id === habitId && l.done).map((l) => l.date), today);

  return (
    <div className="space-y-5 p-4 pt-6 pb-24">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground mb-2"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("habits.title")}</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> {t("common.add")}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("habits.addTitle")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label htmlFor="habit-name">{t("habits.name")}</Label><Input id="habit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("habits.nameHint")} /></div>
              <div className="flex gap-2 pt-1">
                <Button className="flex-1" onClick={() => addMutation.mutate()} disabled={!name.trim() || addMutation.isPending}>{addMutation.isPending ? t("common.saving") : t("common.save")}</Button>
                <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <h2 className="text-base font-semibold">{t("habits.today")}</h2>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : habits.length === 0 ? (
        <Card><CardContent className="p-6 text-center space-y-3">
          <p className="text-muted-foreground">{t("habits.empty")}</p>
          <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>{t("habits.seedDefaults")}</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {(habits as any[]).map((habit) => {
            const done = isDone(habit.id);
            const streak = streakFor(habit.id);
            return (
              <Card key={habit.id} className="border-0 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="flex flex-1 items-center gap-3 text-left"
                      onClick={() => toggleMutation.mutate({ habitId: habit.id, done: !done })}
                      aria-pressed={done}
                      // While this habit's toggle is in flight the button is
                      // disabled, so a rapid double-tap cannot fire a second
                      // toggle off the same stale state.
                      disabled={toggleMutation.isPending && toggleMutation.variables?.habitId === habit.id}
                    >
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>
                        <Check className="h-4 w-4" />
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${done ? "line-through text-muted-foreground" : ""}`}>{habit.name}</p>
                        {streak > 0 && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Flame className="h-3 w-3" /> {t("habits.streak", { days: streak })}
                          </p>
                        )}
                      </div>
                    </button>
                    <ConfirmDelete onConfirm={() => deleteMutation.mutate(habit.id)} itemName={habit.name}>
                      <Button variant="ghost" size="icon" aria-label={t("common.delete")}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </ConfirmDelete>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
