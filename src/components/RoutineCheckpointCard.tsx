import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Flag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/backend";
import { formatINR } from "@/lib/currency";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useAuth";
import {
  DEFAULT_SCHEDULE,
  mergeMilestones,
  milestoneForNow,
  mergeSchedule,
  milestoneIsUnset,
} from "@/lib/routine";

/**
 * Home widget: today's earning checkpoints (trial planning targets, editable
 * in /routine) next to today's actual gross. Shown between the earnings card
 * and quick actions; renders nothing while settings load so the page does
 * not shift.
 */
export default function RoutineCheckpointCard({ todayIncome }: { todayIncome: number }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: settings = [] } = useQuery({
    queryKey: ["routine_settings"],
    queryFn: async () => {
      const { data, error } = await db.from("routine_settings").select("*");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const schedule = mergeSchedule(
    (settings as any[]).filter((r) => r.kind === "schedule"),
  );
  const milestones = mergeMilestones(
    (settings as any[])
      .filter((r) => r.kind === "milestone")
      .map((r) => ({ key: r.key, min: Number(r.min_amount) || 0, max: Number(r.max_amount) || 0 })),
  ).filter((m) => !milestoneIsUnset(m));
  const timeForKey = (key: string) =>
    (schedule.find((s) => s.key === key) ?? DEFAULT_SCHEDULE.find((s) => s.key === key))?.time ?? "00:00";

  // No targets set yet: stay hidden instead of showing a ₹0–₹0 card.
  // The ACTIVE target is the next upcoming checkpoint: between 10:30 and
  // 13:30 the driver is accumulating toward the 13:30 target, not still
  // chasing the 10:30 one. Only after the last checkpoint do we show it
  // with the day's final standing.
  const { current, next } = milestoneForNow(milestones, timeForKey);
  const shown = next ?? current;
  const isFinal = !next && !!current;
  if (!shown) return null;

  return (
    <section className="animate-in fade-in duration-300">
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3">
          <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => navigate("/routine")}>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Flag className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {isFinal ? t("checkpoint.finalTarget") : t("checkpoint.nowTarget")} ({timeForKey(shown.key)} {t("checkpoint.byTime")})
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatINR(shown.min)}–{formatINR(shown.max)} • {t("checkpoint.soFar")}: {formatINR(todayIncome)}
                </p>
                <p className="text-[11px] text-muted-foreground">{t("checkpoint.trial")}</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </CardContent>
      </Card>
    </section>
  );
}
