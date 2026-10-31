import { useState, useCallback } from "react";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isToday, isTomorrow, parseISO, isBefore, addDays } from "date-fns";
import { X, CheckCheck } from "lucide-react";

interface Notification {
  id: string;
  title: string;
  description: string;
  type: "reminder" | "emi" | "car_check" | "goal" | "health" | "car_document";
  date: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("dismissed_notifications");
      if (!stored) return new Set();
      const parsed = JSON.parse(stored);
      // Reset if from a different day
      if (parsed.date !== todayKey) return new Set();
      return new Set(parsed.ids);
    } catch { return new Set(); }
  });
  const [allCleared, setAllCleared] = useState(() => {
    try {
      const stored = localStorage.getItem("all_notifications_cleared");
      if (!stored) return false;
      const parsed = JSON.parse(stored);
      // Reset daily so new notifications appear
      return parsed.date === todayKey;
    } catch { return false; }
  });
  const now = new Date();
  const twoDaysLater = addDays(now, 2);

  const { data: reminders = [] } = useQuery({
    queryKey: ["notifications_reminders"],
    queryFn: async () => {
      // No is_completed filter here: reminders created from the page
      // before the fix lack the field entirely, and Firestore equality
      // does not match missing fields. Completed ones are skipped below.
      const { data } = await db
        .from("reminders")
        .select("*");
      return data ?? [];
    },
    enabled: !!user,
  });

  // Same query (and queryFn) as HomePage's ["debts_active"]: sharing the
  // key lets react-query dedupe the identical Firestore read on Home.
  // Legacy debts without an is_active flag count as active (same rule
  // as DebtsPage/HomePage, audit 2026-10-24).
  const { data: debts = [] } = useQuery({
    queryKey: ["debts_active"],
    queryFn: async () => {
      const { data } = await db
        .from("debts")
        .select("*");
      return (data ?? []).filter((d: any) => d.is_active !== false);
    },
    enabled: !!user,
  });

  const { data: carChecks = [] } = useQuery({
    queryKey: ["notifications_car_checks"],
    queryFn: async () => {
      const { data } = await db
        .from("car_checks")
        .select("*");
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: carDocuments = [] } = useQuery({
    queryKey: ["notifications_car_documents"],
    queryFn: async () => {
      const { data } = await db.from("car_documents").select("*");
      return data ?? [];
    },
    enabled: !!user,
  });

  // Same query (and queryFn) as HomePage's ["goals_active"]: sharing the
  // key lets react-query dedupe the identical Firestore read on Home.
  const { data: goals = [] } = useQuery({
    queryKey: ["goals_active"],
    queryFn: async () => {
      const { data } = await db
        .from("goals")
        .select("*")
        .eq("is_completed", false);
      return data ?? [];
    },
    enabled: !!user,
  });

  const todayStr = format(now, "yyyy-MM-dd");
  const { data: healthLog } = useQuery({
    queryKey: ["notifications_health", todayStr],
    queryFn: async () => {
      const { data } = await db
        .from("health_logs")
        .select("*")
        .eq("log_date", todayStr)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const notifications: Notification[] = [];

  const formatDueLabel = (d: Date) =>
    isToday(d) ? t("notif.dueToday") : isTomorrow(d) ? t("notif.dueTomorrow") : t("notif.dueOn", { date: format(d, "MMM dd") });

  // Preset reminder categories are stored as English keys; show the
  // translated label. Custom categories typed by the user stay as-is.
  const categoryLabel = (c: string) =>
    c === "insurance" ? t("notif.catInsurance")
    : c === "puc" ? t("notif.catPuc")
    : c === "license" ? t("notif.catLicense")
    : c === "emi" ? t("notif.catEmi")
    : c === "maintenance" ? t("notif.catMaintenance")
    : c === "general" ? t("notif.catGeneral")
    : c;

  // Reminders with notify_at — include ALL past-due pending reminders,
  // not just the last day's: a 3-day-overdue reminder used to vanish
  // from the bell entirely (audit 2026-10-24). Pending = is_completed
  // is not true: docs created from the page before the fix carry no
  // is_completed field at all, and must still surface.
  reminders.forEach((r: any) => {
    if (r.is_completed === true) return;
    const notifyAt = r.notify_at ? parseISO(r.notify_at) : parseISO(r.reminder_date);
    if (isBefore(notifyAt, twoDaysLater)) {
      const dueDate = format(parseISO(r.reminder_date), "dd MMM yyyy");
      notifications.push({
        id: `rem-${r.id}`,
        title: r.title,
        description: t("notif.reminderDesc", { due: formatDueLabel(notifyAt), date: dueDate, category: categoryLabel(r.category) }) + (r.notify_at ? ` • ${format(notifyAt, "hh:mm a")}` : ""),
        type: "reminder",
        date: r.reminder_date,
      });
    }
  });

  // Debts with notify_at or EMI day match
  debts.forEach((debt: any) => {
    if (debt.notify_at) {
      const notifyAt = parseISO(debt.notify_at);
      if (isBefore(notifyAt, twoDaysLater) && !isBefore(notifyAt, addDays(now, -1))) {
        const emiDueDate = format(notifyAt, "dd MMM yyyy");
        notifications.push({
          id: `emi-${debt.id}`,
          title: t("notif.emiDueTitle", { name: debt.name }),
          description: t("notif.emiDesc", { date: emiDueDate, amount: Number(debt.emi_amount || 0).toLocaleString("en-IN"), time: format(notifyAt, "hh:mm a") }),
          type: "emi",
          date: format(notifyAt, "yyyy-MM-dd"),
        });
        return;
      }
    }
    // Fallback: day-of-month match. Debts written before start_date was
    // set at creation may not have one — parseISO on a missing/invalid
    // value yields an Invalid Date (NaN day), which must not match.
    // Clamp the due day to the month's length: a debt started on the
    // 31st must notify on 28 Feb / 30 Apr, not never (audit 2026-10-24).
    if (!debt.start_date) return;
    const startDate = parseISO(debt.start_date);
    if (Number.isNaN(startDate.getTime())) return;
    const startDay = startDate.getDate();
    const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const today = now.getDate();
    const tomorrowDate = addDays(now, 1);
    const tomorrow = tomorrowDate.getDate();
    const dueToday = Math.min(startDay, daysInMonth(now)) === today;
    const dueTomorrow = Math.min(startDay, daysInMonth(tomorrowDate)) === tomorrow;
    if (dueToday || dueTomorrow) {
      const dueLabel = dueToday ? format(now, "dd MMM yyyy") : format(addDays(now, 1), "dd MMM yyyy");
      notifications.push({
        id: `emi-day-${debt.id}`,
        title: t("notif.emiDueTitle", { name: debt.name }),
        description: dueToday
          ? t("notif.emiDueTodayDesc", { date: dueLabel, amount: Number(debt.emi_amount || 0).toLocaleString("en-IN") })
          : t("notif.emiDueTomorrowDesc", { date: dueLabel, amount: Number(debt.emi_amount || 0).toLocaleString("en-IN") }),
        type: "emi",
        date: format(now, "yyyy-MM-dd"),
      });
    }
  });

  // Car checks with notify_at
  carChecks.forEach((cc: any) => {
    const notifyAt = cc.notify_at ? parseISO(cc.notify_at) : cc.next_due_date ? parseISO(cc.next_due_date) : null;
    if (!notifyAt) return;
    if (isBefore(notifyAt, twoDaysLater) && !isBefore(notifyAt, addDays(now, -1))) {
      const carDueDate = cc.next_due_date ? format(parseISO(cc.next_due_date), "dd MMM yyyy") : format(notifyAt, "dd MMM yyyy");
      notifications.push({
        id: `car-${cc.id}`,
        title: cc.check_type,
        description: t("notif.carDesc", { date: carDueDate, maintenance: t("notif.carMaintenance") }) + (cc.notify_at ? ` • ${format(notifyAt, "hh:mm a")}` : ""),
        type: "car_check",
        date: cc.next_due_date || format(notifyAt, "yyyy-MM-dd"),
      });
    }
  });

  // Goals with notify_at
  goals.forEach((g: any) => {
    if (!g.notify_at) return;
    const notifyAt = parseISO(g.notify_at);
    if (isBefore(notifyAt, twoDaysLater) && !isBefore(notifyAt, addDays(now, -1))) {
      const goalDueDate = g.deadline ? format(parseISO(g.deadline), "dd MMM yyyy") : format(notifyAt, "dd MMM yyyy");
      notifications.push({
        id: `goal-${g.id}`,
        title: g.title,
        description: t("notif.goalDesc", { date: goalDueDate, deadline: t("notif.goalDeadline"), time: format(notifyAt, "hh:mm a") }),
        type: "goal",
        date: format(notifyAt, "yyyy-MM-dd"),
      });
    }
  });

  // Car document expiry alerts
  carDocuments.forEach((doc: any) => {
    const expiryDate = parseISO(doc.expiry_date);
    const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 30) {
      const label = daysLeft < 0 ? t("notif.expired") : daysLeft === 0 ? t("notif.expiresToday") : t("notif.expiresIn", { days: daysLeft });
      notifications.push({
        id: `doc-${doc.id}`,
        title: `📄 ${doc.document_name}`,
        description: t("notif.expiryDesc", { label, date: format(expiryDate, "dd MMM yyyy") }),
        type: "car_document",
        date: doc.expiry_date,
      });
    }
  });

  // Daily health reminders
  const waterCount = healthLog?.water_glasses || 0;
  const breaksCount = healthLog?.breaks_taken || 0;
  const sleepHours = healthLog?.sleep_hours || 0;

  if (waterCount < 8) {
    notifications.push({
      id: "health-water",
      title: t("notif.drinkWater"),
      description: t("notif.waterDesc", { count: waterCount }),
      type: "health",
      date: todayStr,
    });
  }
  if (breaksCount < 4) {
    notifications.push({
      id: "health-break",
      title: t("notif.takeBreak"),
      description: t("notif.breakDesc", { count: breaksCount }),
      type: "health",
      date: todayStr,
    });
  }
  if (sleepHours === 0 && !healthLog) {
    notifications.push({
      id: "health-sleep",
      title: t("notif.logSleep"),
      description: t("notif.sleepDesc"),
      type: "health",
      date: todayStr,
    });
  }

  const visibleNotifications = allCleared
    ? []
    : notifications.filter((n) => !dismissedIds.has(n.id));

  const count = visibleNotifications.length;

  const dismissOne = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(id);
      localStorage.setItem("dismissed_notifications", JSON.stringify({ date: todayKey, ids: [...next] }));
      return next;
    });
  }, [todayKey]);

  const clearAll = useCallback(() => {
    setAllCleared(true);
    localStorage.setItem("all_notifications_cleared", JSON.stringify({ date: todayKey }));
  }, [todayKey]);

  const typeColor = (type: Notification["type"]) => {
    switch (type) {
      case "emi": return "bg-destructive/10 text-destructive";
      case "reminder": return "bg-warning/10 text-warning";
      case "car_check": return "bg-primary/10 text-primary";
      case "car_document": return "bg-warning/10 text-warning";
      case "goal": return "bg-success/10 text-success";
      case "health": return "bg-accent text-accent-foreground";
    }
  };

  const typeLabel = (type: Notification["type"]) => {
    switch (type) {
      case "emi": return t("notif.emi");
      case "reminder": return t("notif.reminder");
      case "car_check": return t("notif.carCheck");
      case "car_document": return t("notif.document");
      case "goal": return t("notif.goal");
      case "health": return t("notif.health");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b p-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("notif.title")}</h3>
          {visibleNotifications.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1" onClick={clearAll}>
              <CheckCheck className="h-3.5 w-3.5" /> {t("notif.clearAll")}
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {visibleNotifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {t("notif.none")}
            </div>
          ) : (
            visibleNotifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 border-b p-3 last:border-0 group">
                <div className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${typeColor(n.type)}`}>
                  {typeLabel(n.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.description}</p>
                </div>
                <button
                  onClick={() => dismissOne(n.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 p-0.5 rounded hover:bg-muted"
                  aria-label={t("notif.dismiss")}
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
