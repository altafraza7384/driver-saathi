import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Moon, Droplets, Coffee, Footprints, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import { localToday } from "@/lib/budgets";

export default function HealthPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const today = localToday(); // local date, not UTC (audit 2026-10-24)

  // One health log per day. Doc id is deterministic (hl_yyyy-MM-dd) so
  // rapid taps / a tap + Save can never create duplicate docs for the same
  // day. Before this, each quick tap that raced the first insert added
  // another doc: maybeSingle() then saw >1 rows, errored, and the counters
  // fell back to 0 on refresh, while "Days Logged" counted every duplicate
  // (QA 2026-11-01: 4/7 after one day). Legacy duplicate docs from before
  // this fix are tolerated: we pick the newest for today and dedupe by day.
  const todayDocId = `hl_${today}`;
  type HealthLog = { id: string; log_date: string; sleep_hours?: number; water_glasses?: number; breaks_taken?: number; steps?: number; updated_at?: string };
  const pickLatest = (rows: HealthLog[]): HealthLog | null => {
    if (!rows.length) return null;
    const own = rows.find((r) => r.id === todayDocId);
    if (own) return own;
    return [...rows].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
  };

  const { data: log, isLoading } = useQuery({
    queryKey: ["health_log", today],
    queryFn: async () => {
      const { data, error } = await db.from("health_logs").select("*").eq("log_date", today);
      if (error) throw error;
      return pickLatest((data ?? []) as HealthLog[]);
    },
    enabled: !!user,
  });

  const [form, setForm] = useState({ sleep_hours: "0", water_glasses: "0", breaks_taken: "0", steps: "0" });
  // Form-sheet pattern (Phase 6, presentation only): this page has no
  // per-field validation rules, so a save failure is shown beneath the
  // fields in addition to the toast, in a reserved slot so the footer
  // does not move. Form values are retained on failure.
  const [saveError, setSaveError] = useState("");
  // Latest form values for async handlers (rapid taps must build on each
  // other, not on a stale render's state).
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    if (log) setForm({ sleep_hours: String(log.sleep_hours || 0), water_glasses: String(log.water_glasses || 0), breaks_taken: String(log.breaks_taken || 0), steps: String(log.steps || 0) });
  }, [log]);

  const upsertLog = async (current: typeof form) => {
    if (!user) throw new Error("Please sign in again.");
    const payload = {
      id: todayDocId,
      user_id: user.id,
      log_date: today,
      sleep_hours: Number(current.sleep_hours) || 0,
      water_glasses: Number(current.water_glasses) || 0,
      breaks_taken: Number(current.breaks_taken) || 0,
      steps: Number(current.steps) || 0,
    };
    const { error } = await db.from("health_logs").upsert(payload);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["health_log"] });
    queryClient.invalidateQueries({ queryKey: ["health_logs_week"] });
    // Partial key: also matches the bell's ["notifications_health", date].
    queryClient.invalidateQueries({ queryKey: ["notifications_health"] });
  };

  const quickMark = async (key: "water_glasses" | "breaks_taken" | "steps", increment: number) => {
    const next = { ...formRef.current, [key]: String((Number(formRef.current[key]) || 0) + increment) };
    formRef.current = next;
    setForm(next);
    try {
      await upsertLog(next);
      toast.success(
        key === "water_glasses" ? t("health.waterAdded", { count: next.water_glasses })
        : key === "breaks_taken" ? t("health.breakAdded", { count: next.breaks_taken })
        : t("health.stepsAdded", { count: Number(next.steps).toLocaleString("en-IN") })
      );
    } catch (e) {
      toast.error(friendlyErrorMessage(e as Error));
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => { await upsertLog(formRef.current); },
    onSuccess: () => { setSaveError(""); toast.success(t("health.logSaved")); },
    onError: (e: Error) => { setSaveError(friendlyErrorMessage(e)); toast.error(friendlyErrorMessage(e)); },
  });

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  const { data: weeklyLogs = [] } = useQuery({
    queryKey: ["health_logs_week"],
    queryFn: async () => {
      const { data, error } = await db.from("health_logs").select("*").gte("log_date", format(weekStart, "yyyy-MM-dd")).lte("log_date", format(weekEnd, "yyyy-MM-dd")).order("log_date", { ascending: true });
      if (error) throw error;
      // One entry per day (legacy duplicates collapse to the newest), so
      // "Days Logged" counts days, not documents.
      const byDay = new Map<string, HealthLog[]>();
      for (const row of (data ?? []) as HealthLog[]) {
        byDay.set(row.log_date, [...(byDay.get(row.log_date) ?? []), row]);
      }
      return [...byDay.values()].map((rows) => {
        const own = rows.find((r) => r.id === `hl_${rows[0].log_date}`);
        return own ?? [...rows].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
      });
    },
    enabled: !!user,
  });

  const avgSleep = weeklyLogs.length > 0 ? weeklyLogs.reduce((s, l) => s + (Number(l.sleep_hours) || 0), 0) / weeklyLogs.length : 0;
  const avgWater = weeklyLogs.length > 0 ? weeklyLogs.reduce((s, l) => s + (l.water_glasses || 0), 0) / weeklyLogs.length : 0;

  const metrics = [
    { icon: Moon, label: t("health.sleep"), value: form.sleep_hours, key: "sleep_hours" as const, max: 10, color: "text-blue-500" },
    { icon: Droplets, label: t("health.water"), value: form.water_glasses, key: "water_glasses" as const, max: 12, color: "text-cyan-500" },
    { icon: Coffee, label: t("health.breaks"), value: form.breaks_taken, key: "breaks_taken" as const, max: 8, color: "text-amber-500" },
    { icon: Footprints, label: t("health.steps"), value: form.steps, key: "steps" as const, max: 10000, color: "text-green-500" },
  ];

  return (
    <div className="space-y-5 p-4 pt-6">
      <h1 className="text-2xl font-bold">{t("nav.health")}</h1>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (<>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" className="flex-col h-auto py-3 gap-1" onClick={() => quickMark("water_glasses", 1)}>
          <Droplets className="h-5 w-5 text-cyan-500" /><span className="text-xs font-medium">{t("health.addWater")}</span><span className="text-[10px] text-muted-foreground">{form.water_glasses}/8</span>
        </Button>
        <Button variant="outline" className="flex-col h-auto py-3 gap-1" onClick={() => quickMark("breaks_taken", 1)}>
          <Coffee className="h-5 w-5 text-amber-500" /><span className="text-xs font-medium">{t("health.addBreak")}</span><span className="text-[10px] text-muted-foreground">{form.breaks_taken}/4</span>
        </Button>
        <Button variant="outline" className="flex-col h-auto py-3 gap-1" onClick={() => quickMark("steps", 1000)}>
          <Footprints className="h-5 w-5 text-green-500" /><span className="text-xs font-medium">{t("health.addSteps")}</span><span className="text-[10px] text-muted-foreground">{Number(form.steps).toLocaleString()}</span>
        </Button>
      </div>

      <div className="space-y-3">
        {metrics.map((m, i) => {
          const isDone = m.key === "water_glasses" ? Number(m.value) >= 8 : m.key === "breaks_taken" ? Number(m.value) >= 4 : m.key === "sleep_hours" ? Number(m.value) >= 7 : Number(m.value) >= 5000;
          return (
            <motion.div key={m.key} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}>
              <Card className={isDone ? "border-success/30 bg-success/5" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isDone ? <CheckCircle2 className="h-5 w-5 text-success" /> : <m.icon className={`h-5 w-5 ${m.color}`} />}
                      <Label htmlFor={`health-${m.key}`} className="text-sm font-medium">{m.label}</Label>
                    </div>
                    <Input id={`health-${m.key}`} type="number" className="w-20 text-right" value={m.value} onChange={(e) => { setForm({ ...form, [m.key]: e.target.value }); setSaveError(""); }} />
                  </div>
                  <Progress value={Math.min((Number(m.value) / m.max) * 100, 100)} className="h-2" />
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      </>)}

      <div className="pt-1">
        <p className="min-h-5 text-sm text-destructive">{saveError}</p>
        <Button className="w-full gap-2" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading}>
          <Save className="h-4 w-4" /> {saveMutation.isPending ? t("common.saving") : t("health.saveTodayLog")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold">{t("health.weeklyReport")}</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-muted-foreground">{t("health.avgSleep")}</p><p className="text-lg font-bold">{avgSleep.toFixed(1)} hrs</p></div>
            <div><p className="text-muted-foreground">{t("health.avgWater")}</p><p className="text-lg font-bold">{avgWater.toFixed(1)}</p></div>
            <div><p className="text-muted-foreground">{t("health.daysLogged")}</p><p className="text-lg font-bold">{weeklyLogs.length}/7</p></div>
            <div><p className="text-muted-foreground">{t("health.totalSteps")}</p><p className="text-lg font-bold">{weeklyLogs.reduce((s, l) => s + (l.steps || 0), 0).toLocaleString()}</p></div>
          </div>
          {(() => {
            const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
            const maxSleep = Math.max(...days.map(day => { const dl = weeklyLogs.find(l => isSameDay(parseISO(l.log_date), day)); return Number(dl?.sleep_hours || 0); }), 1);
            const maxWaterDay = Math.max(...days.map(day => { const dl = weeklyLogs.find(l => isSameDay(parseISO(l.log_date), day)); return Number(dl?.water_glasses || 0); }), 1);
            return (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("health.sleepWaterDaily")}</p>
                <div className="flex items-end gap-1 h-16">
                  {days.map(day => {
                    const dayLog = weeklyLogs.find(l => isSameDay(parseISO(l.log_date), day));
                    const sleepH = dayLog ? (Number(dayLog.sleep_hours) / maxSleep) * 100 : 0;
                    const waterH = dayLog ? (Number(dayLog.water_glasses) / maxWaterDay) * 100 : 0;
                    const isToday = isSameDay(day, new Date());
                    return (
                      <div key={day.toISOString()} className="flex-1 flex flex-col items-center gap-0.5">
                        <div className="flex gap-0.5 items-end w-full justify-center h-12">
                          <div className="w-2 rounded-t bg-blue-500/70" style={{ height: `${Math.max(sleepH, 4)}%` }} />
                          <div className="w-2 rounded-t bg-cyan-500/70" style={{ height: `${Math.max(waterH, 4)}%` }} />
                        </div>
                        <span className={`text-[9px] ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>{format(day, "EEE").charAt(0)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 justify-center text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-blue-500/70" /> {t("health.sleep").split(" ")[0]}</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-cyan-500/70" /> {t("health.water").split(" ")[0]}</span>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
