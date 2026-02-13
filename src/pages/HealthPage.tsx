import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Moon, Droplets, Coffee, Footprints, Save } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const today = new Date().toISOString().split("T")[0];

export default function HealthPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data: log, isLoading } = useQuery({
    queryKey: ["health_log", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("health_logs")
        .select("*")
        .eq("user_id", user!.id)
        .eq("log_date", today)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const [form, setForm] = useState({ sleep_hours: "0", water_glasses: "0", breaks_taken: "0", steps: "0" });

  // Sync form with loaded data
  useState(() => {
    if (log) {
      setForm({
        sleep_hours: String(log.sleep_hours || 0),
        water_glasses: String(log.water_glasses || 0),
        breaks_taken: String(log.breaks_taken || 0),
        steps: String(log.steps || 0),
      });
    }
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        user_id: user!.id,
        log_date: today,
        sleep_hours: Number(form.sleep_hours),
        water_glasses: Number(form.water_glasses),
        breaks_taken: Number(form.breaks_taken),
        steps: Number(form.steps),
      };
      if (log) {
        const { error } = await supabase.from("health_logs").update(payload).eq("id", log.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("health_logs").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health_log"] });
      toast.success("Health log saved!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Weekly data
  const { data: weeklyLogs = [] } = useQuery({
    queryKey: ["health_logs_week"],
    queryFn: async () => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { data, error } = await supabase
        .from("health_logs")
        .select("*")
        .gte("log_date", weekAgo.toISOString().split("T")[0])
        .order("log_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const avgSleep = weeklyLogs.length > 0 ? weeklyLogs.reduce((s, l) => s + Number(l.sleep_hours), 0) / weeklyLogs.length : 0;
  const avgWater = weeklyLogs.length > 0 ? weeklyLogs.reduce((s, l) => s + (l.water_glasses || 0), 0) / weeklyLogs.length : 0;

  const metrics = [
    { icon: Moon, label: "Sleep (hrs)", value: form.sleep_hours, key: "sleep_hours" as const, max: 10, color: "text-blue-500" },
    { icon: Droplets, label: "Water (glasses)", value: form.water_glasses, key: "water_glasses" as const, max: 12, color: "text-cyan-500" },
    { icon: Coffee, label: "Breaks", value: form.breaks_taken, key: "breaks_taken" as const, max: 8, color: "text-amber-500" },
    { icon: Footprints, label: "Steps", value: form.steps, key: "steps" as const, max: 10000, color: "text-green-500" },
  ];

  return (
    <div className="space-y-5 p-4 pt-6">
      <h1 className="text-2xl font-bold">{t("nav.health")}</h1>

      {/* Today's Log */}
      <div className="space-y-3">
        {metrics.map((m, i) => (
          <motion.div key={m.key} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <m.icon className={`h-5 w-5 ${m.color}`} />
                    <span className="text-sm font-medium">{m.label}</span>
                  </div>
                  <Input type="number" className="w-20 text-right" value={m.value}
                    onChange={(e) => setForm({ ...form, [m.key]: e.target.value })} />
                </div>
                <Progress value={Math.min((Number(m.value) / m.max) * 100, 100)} className="h-2" />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Button className="w-full gap-2" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        <Save className="h-4 w-4" /> {saveMutation.isPending ? "Saving..." : "Save Today's Log"}
      </Button>

      {/* Weekly Summary */}
      {weeklyLogs.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Weekly Summary</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Avg Sleep</p>
                <p className="text-lg font-bold">{avgSleep.toFixed(1)} hrs</p>
              </div>
              <div>
                <p className="text-muted-foreground">Avg Water</p>
                <p className="text-lg font-bold">{avgWater.toFixed(1)} glasses</p>
              </div>
              <div>
                <p className="text-muted-foreground">Days Logged</p>
                <p className="text-lg font-bold">{weeklyLogs.length}/7</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Steps</p>
                <p className="text-lg font-bold">{weeklyLogs.reduce((s, l) => s + (l.steps || 0), 0).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
