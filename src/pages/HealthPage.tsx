import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Moon, Droplets, Coffee, Footprints, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO } from "date-fns";

export default function HealthPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];

  const { data: log, isLoading } = useQuery({
    queryKey: ["health_log", today],
    queryFn: async () => {
      const { data, error } = await supabase.from("health_logs").select("*").eq("user_id", user!.id).eq("log_date", today).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const [form, setForm] = useState({ sleep_hours: "0", water_glasses: "0", breaks_taken: "0", steps: "0" });

  useEffect(() => {
    if (log) setForm({ sleep_hours: String(log.sleep_hours || 0), water_glasses: String(log.water_glasses || 0), breaks_taken: String(log.breaks_taken || 0), steps: String(log.steps || 0) });
  }, [log]);

  const upsertLog = async (updates: Partial<{ sleep_hours: number; water_glasses: number; breaks_taken: number; steps: number }>) => {
    if (!user) return;
    const payload = { user_id: user.id, log_date: today, sleep_hours: Number(form.sleep_hours), water_glasses: Number(form.water_glasses), breaks_taken: Number(form.breaks_taken), steps: Number(form.steps), ...updates };
    if (log) await supabase.from("health_logs").update(payload).eq("id", log.id);
    else await supabase.from("health_logs").insert(payload);
    queryClient.invalidateQueries({ queryKey: ["health_log"] });
    queryClient.invalidateQueries({ queryKey: ["health_logs_week"] });
  };

  const quickMark = async (key: "water_glasses" | "breaks_taken" | "steps", increment: number) => {
    const newVal = Number(form[key]) + increment;
    setForm(prev => ({ ...prev, [key]: String(newVal) }));
    await upsertLog({ [key]: newVal });
    toast.success(key === "water_glasses" ? "💧" : key === "breaks_taken" ? "☕" : "🚶");
  };

  const saveMutation = useMutation({
    mutationFn: async () => { await upsertLog({}); },
    onSuccess: () => toast.success("✅"),
    onError: (e: Error) => toast.error(e.message),
  });

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

  const { data: weeklyLogs = [] } = useQuery({
    queryKey: ["health_logs_week"],
    queryFn: async () => {
      const { data, error } = await supabase.from("health_logs").select("*").gte("log_date", format(weekStart, "yyyy-MM-dd")).lte("log_date", format(weekEnd, "yyyy-MM-dd")).order("log_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const avgSleep = weeklyLogs.length > 0 ? weeklyLogs.reduce((s, l) => s + Number(l.sleep_hours), 0) / weeklyLogs.length : 0;
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
                      <span className="text-sm font-medium">{m.label}</span>
                    </div>
                    <Input type="number" className="w-20 text-right" value={m.value} onChange={(e) => setForm({ ...form, [m.key]: e.target.value })} />
                  </div>
                  <Progress value={Math.min((Number(m.value) / m.max) * 100, 100)} className="h-2" />
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <Button className="w-full gap-2" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        <Save className="h-4 w-4" /> {saveMutation.isPending ? t("common.saving") : t("health.saveTodayLog")}
      </Button>

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