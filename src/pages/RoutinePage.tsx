import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { ArrowLeft, BellRing, Save } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/date-time-picker";
import { foregroundNotificationId, requestLocalNotificationPermission } from "@/lib/native-push";
import {
  ScheduleItem,
  Milestone,
  mergeSchedule,
  mergeMilestones,
  buildDailyNotifications,
  routineNotificationId,
  SCHEDULE_KEYS,
} from "@/lib/routine";

export default function RoutinePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [schedule, setSchedule] = useState<ScheduleItem[]>(() => mergeSchedule([]));
  const [milestones, setMilestones] = useState<Milestone[]>(() => mergeMilestones([]));
  const [notifStatus, setNotifStatus] = useState<string>("");

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ["routine_settings"],
    queryFn: async () => {
      const { data, error } = await db.from("routine_settings").select("*");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  useEffect(() => {
    setSchedule(mergeSchedule((settings as any[]).filter((r) => r.kind === "schedule")));
    setMilestones(
      mergeMilestones(
        (settings as any[])
          .filter((r) => r.kind === "milestone")
          .map((r) => ({ key: r.key, min: Number(r.min_amount) || 0, max: Number(r.max_amount) || 0 })),
      ),
    );
  }, [settings]);

  const titleFor = (key: string) => t(`routine.item.${key}`);

  /** Cancel every routine reminder we know, then schedule the enabled set.
   *  Ids are stable per key, so rescheduling never leaves duplicates. */
  const reschedule = async (items: ScheduleItem[]): Promise<void> => {
    const granted = await requestLocalNotificationPermission();
    if (!granted) {
      setNotifStatus(t("routine.noPermission"));
      return;
    }
    try {
      await LocalNotifications.cancel({
        notifications: SCHEDULE_KEYS.map((key) => ({ id: routineNotificationId(key) })),
      });
      const notifications = buildDailyNotifications(items, titleFor);
      if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
      setNotifStatus(t("routine.notifScheduled", { count: notifications.length }));
    } catch (e) {
      // Web without Notification support, or an old APK missing the native
      // plugin: the settings still save, only the reminders cannot fire.
      setNotifStatus(t("routine.notifFailed"));
      console.warn("Routine schedule failed", e);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const rows = settings as any[];
      for (const item of schedule) {
        const existing = rows.find((r) => r.kind === "schedule" && r.key === item.key);
        const payload = { kind: "schedule", key: item.key, time: item.time, enabled: item.enabled, message: item.message };
        if (existing) {
          const { error } = await db.from("routine_settings").update(payload).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await db.from("routine_settings").insert({ ...payload, user_id: user!.id });
          if (error) throw error;
        }
      }
      for (const m of milestones) {
        const existing = rows.find((r) => r.kind === "milestone" && r.key === m.key);
        const payload = { kind: "milestone", key: m.key, min_amount: m.min, max_amount: m.max };
        if (existing) {
          const { error } = await db.from("routine_settings").update(payload).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await db.from("routine_settings").insert({ ...payload, user_id: user!.id });
          if (error) throw error;
        }
      }
      await reschedule(schedule);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routine_settings"] });
      toast.success(t("routine.saved"));
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const sendTest = async () => {
    const granted = await requestLocalNotificationPermission();
    if (!granted) {
      setNotifStatus(t("routine.noPermission"));
      return;
    }
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: foregroundNotificationId(),
          title: t("routine.title"),
          body: t("routine.testBody"),
          schedule: { at: new Date(Date.now() + 5000) },
        }],
      });
      setNotifStatus(t("routine.testScheduled"));
    } catch (e) {
      setNotifStatus(t("routine.notifFailed"));
      console.warn("Routine test notification failed", e);
    }
  };

  const updateItem = (key: string, patch: Partial<ScheduleItem>) =>
    setSchedule((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const updateMilestone = (key: string, patch: Partial<Milestone>) =>
    setMilestones((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  const milestoneFor = (key: string) => milestones.find((m) => m.key === key);

  return (
    <div className="space-y-5 p-4 pt-6 pb-24">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground mb-2"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("routine.title")}</h1>
        <Button size="sm" className="gap-1" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading}>
          <Save className="h-4 w-4" /> {saveMutation.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>

      <Card className="border-warning/40 bg-warning/10">
        <CardContent className="p-3 text-sm">{t("routine.alarmNote")}</CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t("routine.schedule")}</h2>
        {schedule.map((item) => (
          <Card key={item.key} className="border-0 shadow-sm">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-semibold">{titleFor(item.key)}</Label>
                <Switch checked={item.enabled} onCheckedChange={(v) => updateItem(item.key, { enabled: v })} aria-label={titleFor(item.key)} />
              </div>
              <div className="flex items-center gap-2">
                <TimePicker id={`routine-time-${item.key}`} label={titleFor(item.key)} value={item.time} onChange={(v) => updateItem(item.key, { time: v })} />
              </div>
              <Textarea rows={2} value={item.message} onChange={(e) => updateItem(item.key, { message: e.target.value })} placeholder={t("routine.messageHint")} />
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t("routine.milestones")}</h2>
        <p className="text-xs text-muted-foreground">{t("routine.milestonesHint")}</p>
        {milestones.map((m) => (
          <Card key={m.key} className="border-0 shadow-sm">
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-semibold">{titleFor(m.key)} ({schedule.find((s) => s.key === m.key)?.time})</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" inputMode="numeric" className="w-24" value={m.min || ""} placeholder="500" onChange={(e) => updateMilestone(m.key, { min: Number(e.target.value) || 0 })} aria-label={`${titleFor(m.key)} min`} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="number" inputMode="numeric" className="w-24" value={m.max || ""} placeholder="700" onChange={(e) => updateMilestone(m.key, { max: Number(e.target.value) || 0 })} aria-label={`${titleFor(m.key)} max`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t("routine.notifications")}</h2>
        <Button variant="outline" className="gap-1" onClick={sendTest}>
          <BellRing className="h-4 w-4" /> {t("routine.testButton")}
        </Button>
        {notifStatus && <p className="text-xs text-muted-foreground">{notifStatus}</p>}
        {!Capacitor.isNativePlatform() && <p className="text-xs text-muted-foreground">{t("routine.webNote")}</p>}
      </section>
    </div>
  );
                  }
