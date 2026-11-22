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
  ShiftMode,
  ScheduleOutcome,
  RoutineSaveResult,
  RoutineSettingPayload,
  findSettingRow,
  mergeSchedule,
  mergeMilestones,
  milestoneRows,
  buildDailyNotifications,
  routineNotificationId,
  routineSettingId,
  schedulePreset,
  resolveShiftMode,
  retimeForMode,
  summarizeRoutineSave,
  validateMilestone,
  SCHEDULE_KEYS,
} from "@/lib/routine";

/** Intended values of the rows whose last save failed. The settings
 *  effect overlays these on top of whatever the refetch returns, so a
 *  failed edit (e.g. cp1 500 -> 600) survives until the retry succeeds
 *  instead of being clobbered by the old stored value. Cleared on a
 *  fully successful save. Kept in sync by every local edit below. */
interface PendingFailedEdits {
  schedule: ScheduleItem[];
  milestones: Milestone[];
  shiftMode: ShiftMode | null;
}

/** Stable empty rows for the routine_settings query default (see below). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMPTY_SETTINGS: any[] = [];

export default function RoutinePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [schedule, setSchedule] = useState<ScheduleItem[]>(() => mergeSchedule([]));
  const [shiftMode, setShiftMode] = useState<ShiftMode>("day");
  const [milestones, setMilestones] = useState<Milestone[]>(() => mergeMilestones([]));
  const [notifStatus, setNotifStatus] = useState<string>("");
  const [pendingFailedEdits, setPendingFailedEdits] = useState<PendingFailedEdits | null>(null);

  // Module-level empty rows: `data: settings = []` would hand the
  // useEffect below a FRESH array on every render while the query is
  // still loading, so the effect (which setStates on [settings]) would
  // re-run after every render and spin the page in a render loop until
  // the fetch resolves. A stable reference breaks that loop.
  const { data: settings = EMPTY_SETTINGS, isLoading } = useQuery({
    queryKey: ["routine_settings"],
    queryFn: async () => {
      const { data, error } = await db.from("routine_settings").select("*");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  useEffect(() => {
    const mergedSchedule = mergeSchedule((settings as any[]).filter((r) => r.kind === "schedule"));
    const mergedMilestones = mergeMilestones(
      milestoneRows((settings as any[]).filter((r) => r.kind === "milestone")),
    );
    // A failed edit is still the driver's intent: overlay it on top of
    // the refetched (old) values, or the next Save would write the old
    // value while reporting success. Applies on every settings change,
    // including the refetch a partial save triggers.
    if (pendingFailedEdits) {
      for (const item of pendingFailedEdits.schedule) {
        const idx = mergedSchedule.findIndex((s) => s.key === item.key);
        if (idx >= 0) mergedSchedule[idx] = item;
      }
      for (const m of pendingFailedEdits.milestones) {
        const idx = mergedMilestones.findIndex((x) => x.key === m.key);
        if (idx >= 0) mergedMilestones[idx] = m;
      }
    }
    setSchedule(mergedSchedule);
    const modeRow = (settings as any[]).find((r) => r.kind === "shift" && r.key === "mode");
    // A failed shift intent takes priority over the stored row: the
    // refetch after a partial save returns the OLD mode, and letting it
    // win would clobber the driver's intent (see resolveShiftMode).
    const storedMode: ShiftMode | null =
      modeRow?.message === "night" ? "night" : modeRow?.message === "day" ? "day" : null;
    setShiftMode(resolveShiftMode(storedMode, pendingFailedEdits?.shiftMode ?? null));
    setMilestones(mergedMilestones);
  }, [settings, pendingFailedEdits]);

  const titleFor = (key: string) => t(`routine.item.${key}`);

  /** Switching Day/Night loads that preset into the editable fields only.
   *  Times stay fully editable and nothing saves until सहेजें/Save. The
   *  toggle changes reminder timings only - never accounting or dates.
   *  A pending failed edit is retimed by the same rule, so it cannot
   *  resurrect pre-toggle times on the next refetch. */
  const applyShiftMode = (mode: ShiftMode) => {
    setSchedule((current) => retimeForMode(current, shiftMode, mode));
    setPendingFailedEdits((prev) =>
      prev
        ? {
            ...prev,
            schedule: prev.schedule.map((item) => {
              const fromTime = schedulePreset(shiftMode).find((f) => f.key === item.key)?.time;
              const toTime = schedulePreset(mode).find((f) => f.key === item.key)?.time;
              return { ...item, time: fromTime === item.time && toTime ? toTime : item.time };
            }),
            shiftMode: mode,
          }
        : prev,
    );
    setShiftMode(mode);
  };

  /** Cancel every routine reminder we know, then schedule the enabled set.
   *  Ids are stable per key, so rescheduling never leaves duplicates.
   *  Returns the outcome instead of setting UI state: the caller reports
   *  scheduling separately from the save (see saveMutation) — a
   *  scheduling failure must never be shown as a failed save. */
  const reschedule = async (items: ScheduleItem[]): Promise<ScheduleOutcome> => {
    try {
      const granted = await requestLocalNotificationPermission();
      if (!granted) return { status: "no-permission" };
      await LocalNotifications.cancel({
        notifications: SCHEDULE_KEYS.map((key) => ({ id: routineNotificationId(key) })),
      });
      const notifications = buildDailyNotifications(items, titleFor, milestones);
      if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
      return { status: "scheduled", count: notifications.length };
    } catch (e) {
      // Web without Notification support, or an old APK missing the native
      // plugin: the settings still save, only the reminders cannot fire.
      console.warn("Routine schedule failed", e);
      return { status: "failed" };
    }
  };

  const saveMutation = useMutation({
    // Every row is attempted even when an earlier one fails, so one bad
    // row cannot silently drop the rest; failures are collected by key
    // and reported as partial, with Save-again as the retry. Each row
    // write is an idempotent upsert (stable kind/key doc id): a retry
    // that cannot see the rows it just wrote overwrites the same docs
    // instead of duplicating them, and a legacy random-id row is updated
    // in place. Scheduling runs only when every row saved — the
    // scheduled reminders must match what is stored.
    mutationFn: async (): Promise<RoutineSaveResult> => {
      const failedKeys: string[] = [];
      const attempt = async (key: string, work: () => Promise<void>) => {
        try {
          await work();
        } catch {
          failedKeys.push(key);
        }
      };
      const rows = settings as any[];
      // The values the driver intended at save time, kept so the failed
      // rows can be preserved (and retried) after the refetch.
      const intendedSchedule = schedule;
      const intendedMilestones = milestones;
      const intendedMode = shiftMode;
      const upsertRow = async (kind: "schedule" | "milestone" | "shift", key: string, payload: RoutineSettingPayload) => {
        const existing = findSettingRow(rows, kind, key);
        if (existing) {
          const { error } = await db.from("routine_settings").update(payload).eq("id", existing.id);
          if (error) throw error;
        } else {
          const { error } = await db.from("routine_settings").insert({ ...payload, id: routineSettingId(kind, key), user_id: user!.id });
          if (error) throw error;
        }
      };
      for (const item of schedule) {
        await attempt(`schedule:${item.key}`, async () => {
          await upsertRow("schedule", item.key, { kind: "schedule", key: item.key, time: item.time, enabled: item.enabled, message: item.message });
        });
      }
      for (const m of milestones) {
        await attempt(`milestone:${m.key}`, async () => {
          await upsertRow("milestone", m.key, { kind: "milestone", key: m.key, min_amount: m.min, max_amount: m.max });
        });
      }
      await attempt("shift:mode", async () => {
        await upsertRow("shift", "mode", { kind: "shift", key: "mode", message: shiftMode });
      });
      const scheduleOutcome = failedKeys.length === 0 ? await reschedule(schedule) : null;
      return {
        failedKeys,
        schedule: scheduleOutcome,
        failedSchedule: intendedSchedule.filter((item) => failedKeys.includes(`schedule:${item.key}`)),
        failedMilestones: intendedMilestones.filter((m) => failedKeys.includes(`milestone:${m.key}`)),
        failedShiftMode: failedKeys.includes("shift:mode") ? intendedMode : null,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["routine_settings"] });
      // Save and scheduling are reported SEPARATELY: the save toast says
      // only whether the settings saved; the status line below says only
      // what scheduling did. A scheduling failure never rewrites the
      // save result, and a partial save never hides behind "saved".
      const total = schedule.length + milestones.length + 1;
      const status = summarizeRoutineSave(result.failedKeys.length, total);
      // Keep the failed rows' intended values, on partial AND on full
      // failure: the invalidation above refetches the OLD stored values,
      // and without this the page would show (and the next Save would
      // write) the old values instead of the driver's edits.
      if (result.failedKeys.length > 0) {
        setPendingFailedEdits({
          schedule: result.failedSchedule,
          milestones: result.failedMilestones,
          shiftMode: result.failedShiftMode,
        });
      } else {
        setPendingFailedEdits(null);
      }
      if (status === "failed") {
        toast.error(t("routine.saveFailed"));
        return;
      }
      if (status === "partial") {
        toast.info(t("routine.savedPartial", { count: result.failedKeys.length }));
      } else {
        toast.success(t("routine.saved"));
      }
      if (!result.schedule) return;
      if (result.schedule.status === "scheduled") {
        setNotifStatus(t("routine.notifScheduled", { count: result.schedule.count }));
      } else if (result.schedule.status === "no-permission") {
        setNotifStatus(t("routine.noPermission"));
      } else {
        setNotifStatus(t("routine.savedButNotScheduled"));
      }
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  /** Invalid targets never reach the save: block with a plain error so
   *  a bad min/max cannot be stored and then misread as a real target. */
  const save = () => {
    const bad = milestones.find((m) => validateMilestone(m.min, m.max) !== null);
    if (bad) {
      toast.error(t("routine.invalidTarget"));
      return;
    }
    saveMutation.mutate();
  };

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

  const updateItem = (key: string, patch: Partial<ScheduleItem>) => {
    setSchedule((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
    // A later manual edit of a failed row replaces the preserved intent
    // with the new value, so a refetch cannot resurrect the stale one.
    setPendingFailedEdits((prev) =>
      prev ? { ...prev, schedule: prev.schedule.map((s) => (s.key === key ? { ...s, ...patch } : s)) } : prev,
    );
  };
  const updateMilestone = (key: string, patch: Partial<Milestone>) => {
    setMilestones((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
    setPendingFailedEdits((prev) =>
      prev ? { ...prev, milestones: prev.milestones.map((m) => (m.key === key ? { ...m, ...patch } : m)) } : prev,
    );
  };

  const milestoneFor = (key: string) => milestones.find((m) => m.key === key);

  return (
    <div className="space-y-5 p-4 pt-6 pb-24">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground mb-2"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("routine.title")}</h1>
        <Button size="sm" className="gap-1" onClick={save} disabled={saveMutation.isPending || isLoading}>
          <Save className="h-4 w-4" /> {saveMutation.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-semibold">{t("routine.shiftMode")}</Label>
            <div className="flex items-center gap-1">
              <Button size="sm" variant={shiftMode === "day" ? "default" : "outline"} onClick={() => applyShiftMode("day")}>{t("routine.shiftDay")}</Button>
              <Button size="sm" variant={shiftMode === "night" ? "default" : "outline"} onClick={() => applyShiftMode("night")}>{t("routine.shiftNight")}</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("routine.shiftNote")}</p>
        </CardContent>
      </Card>

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
