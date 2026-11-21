import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Share2 } from "lucide-react";
import { toast } from "sonner";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { formatINR, toAmount } from "@/lib/currency";
import { localToday } from "@/lib/budgets";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  buildDailyReportText,
  mergeMilestones,
  mergeSchedule,
  milestoneForNow,
  milestoneIsUnset,
  minutesOf,
  incomeEarnedBy,
  ReportCheckpoint,
} from "@/lib/routine";

/**
 * Daily report: today's earnings, expenses, net, habits and checkpoint
 * progress, plus a WhatsApp share button. Sharing opens WhatsApp with the
 * text pre-filled (same wa.me pattern as SOSPage); the user picks the
 * contact and sends — nothing is sent automatically.
 */
export default function DailyReportPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const today = localToday();

  const { data: todayTx = [], isLoading } = useQuery({
    queryKey: ["transactions_today", "totals"],
    queryFn: async () => {
      const { data, error } = await db.from("transactions").select("*").eq("transaction_date", today);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: habits = [] } = useQuery({
    queryKey: ["habits"],
    queryFn: async () => {
      const { data, error } = await db.from("habits").select("*").eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: todayLogs = [] } = useQuery({
    queryKey: ["habit_logs", today],
    queryFn: async () => {
      const { data, error } = await db.from("habit_logs").select("*").eq("date", today);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: settings = [] } = useQuery({
    queryKey: ["routine_settings"],
    queryFn: async () => {
      const { data, error } = await db.from("routine_settings").select("*");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const income = (todayTx as any[]).filter((tx) => tx.type === "income").reduce((s, tx) => s + toAmount(tx.amount), 0);
  const expense = (todayTx as any[]).filter((tx) => tx.type === "expense").reduce((s, tx) => s + toAmount(tx.amount), 0);
  const habitsDone = (todayLogs as any[]).filter((l) => l.done).length;
  const habitsTotal = (habits as any[]).length;

  const schedule = mergeSchedule((settings as any[]).filter((r) => r.kind === "schedule"));
  const milestones = mergeMilestones(
    (settings as any[])
      .filter((r) => r.kind === "milestone")
      .map((r) => ({ key: r.key, min: Number(r.min_amount) || 0, max: Number(r.max_amount) || 0 })),
  ).filter((m) => !milestoneIsUnset(m));
  const timeForKey = (key: string) => schedule.find((s) => s.key === key)?.time ?? "00:00";
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // A checkpoint is judged by income entries LOGGED by its time (each
  // entry's created_at), never by the day's eventual total - otherwise an
  // evening fare would retrospectively "complete" the morning checkpoint.
  // Verdicts are evidence-framed: "covered" when entries logged by the
  // cutoff reach the target, otherwise "not confirmed" (never "missed" -
  // the driver may have earned it without logging in time).
  const checkpoints: (ReportCheckpoint & { noData: boolean })[] = milestones.map((m) => {
    if (minutesOf(timeForKey(m.key)) > nowMin) return { label: `${timeForKey(m.key)} (${formatINR(m.min)}–${formatINR(m.max)})`, met: null, noData: false };
    const earned = incomeEarnedBy(todayTx as any[], today, timeForKey(m.key));
    return {
      label: `${timeForKey(m.key)} (${formatINR(m.min)}–${formatINR(m.max)})`,
      met: earned.total >= m.min,
      noData: earned.count === 0,
    };
  });
  const { current } = milestoneForNow(milestones, timeForKey, now);

  const dateLabel = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const share = () => {
    const text = buildDailyReportText({ dateLabel, income, expense, habitsDone, habitsTotal, checkpoints });
    // wa.me without a number: WhatsApp's own contact picker (same pattern
    // and audit trail as SOSPage). The user chooses who gets the report.
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank");
    toast.success(t("report.openingWhatsapp"));
  };

  return (
    <div className="space-y-5 p-4 pt-6 pb-24">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground mb-2"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("report.title")}</h1>
        <Button size="sm" className="gap-1" onClick={share}>
          <Share2 className="h-4 w-4" /> {t("report.share")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{dateLabel}</p>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : (
        <>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <div className="flex justify-between text-sm"><span>{t("report.income")}</span><span className="font-semibold text-success">{formatINR(income)}</span></div>
              <div className="flex justify-between text-sm"><span>{t("report.expense")}</span><span className="font-semibold text-destructive">{formatINR(expense)}</span></div>
              <div className="flex justify-between border-t pt-2 text-sm"><span>{t("report.net")}</span><span className="font-bold">{formatINR(income - expense)}</span></div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-sm font-semibold">{t("report.habitsDone")}</p>
              <p className="text-sm text-muted-foreground">{habitsDone}/{habitsTotal}</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-1">
              <p className="text-sm font-semibold">{t("report.checkpoints")}</p>
              <p className="text-xs text-muted-foreground">{t("checkpoint.trial")}</p>
              <p className="text-xs text-muted-foreground">{t("report.timeNote")}</p>
              {milestones.length === 0 ? (
                <button className="text-sm text-primary underline" onClick={() => navigate("/routine")}>{t("report.setTargets")}</button>
              ) : (
                <>
                  {checkpoints.map((c) => (
                    <div key={c.label} className="flex justify-between text-sm">
                      <span>{c.label}</span>
                      <span className={c.met !== null && !c.noData && c.met ? "text-success" : "text-muted-foreground"}>
                        {c.met === null ? t("report.pending") : c.noData ? t("report.noData") : c.met ? t("report.covered") : t("report.unconfirmed")}
                      </span>
                    </div>
                  ))}
                  {current && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      {t("checkpoint.soFar")}: {formatINR(income)}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{t("report.shareNote")}</p>
        </>
      )}
    </div>
  );
}
