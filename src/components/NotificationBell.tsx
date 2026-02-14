import { useState, useCallback } from "react";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isToday, isTomorrow, parseISO, isBefore, addDays } from "date-fns";
import { X, CheckCheck } from "lucide-react";

interface Notification {
  id: string;
  title: string;
  description: string;
  type: "reminder" | "emi" | "car_check" | "goal" | "health";
  date: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("dismissed_notifications");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [allCleared, setAllCleared] = useState(() => {
    try {
      return localStorage.getItem("all_notifications_cleared") === "true";
    } catch { return false; }
  });
  const now = new Date();
  const twoDaysLater = addDays(now, 2);

  const { data: reminders = [] } = useQuery({
    queryKey: ["notifications_reminders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("reminders")
        .select("*")
        .eq("is_completed", false);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: debts = [] } = useQuery({
    queryKey: ["notifications_debts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("debts")
        .select("*")
        .eq("is_active", true);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: carChecks = [] } = useQuery({
    queryKey: ["notifications_car_checks"],
    queryFn: async () => {
      const { data } = await supabase
        .from("car_checks")
        .select("*");
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: goals = [] } = useQuery({
    queryKey: ["notifications_goals"],
    queryFn: async () => {
      const { data } = await supabase
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
      const { data } = await supabase
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
    isToday(d) ? "Due today" : isTomorrow(d) ? "Due tomorrow" : `Due ${format(d, "MMM dd")}`;

  // Reminders with notify_at
  reminders.forEach((r: any) => {
    const notifyAt = r.notify_at ? parseISO(r.notify_at) : parseISO(r.reminder_date);
    if (isBefore(notifyAt, twoDaysLater) && !isBefore(notifyAt, addDays(now, -1))) {
      const dueDate = format(parseISO(r.reminder_date), "dd MMM yyyy");
      notifications.push({
        id: `rem-${r.id}`,
        title: r.title,
        description: `${formatDueLabel(notifyAt)} • Due: ${dueDate} • ${r.category}${r.notify_at ? ` • ${format(notifyAt, "hh:mm a")}` : ""}`,
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
          title: `${debt.name} EMI Due`,
          description: `Due: ${emiDueDate} • ₹${Number(debt.emi_amount || 0).toLocaleString("en-IN")} • ${format(notifyAt, "hh:mm a")}`,
          type: "emi",
          date: format(notifyAt, "yyyy-MM-dd"),
        });
        return;
      }
    }
    // Fallback: day-of-month match
    const startDay = parseISO(debt.start_date).getDate();
    const today = now.getDate();
    const tomorrow = addDays(now, 1).getDate();
    if (startDay === today || startDay === tomorrow) {
      const dueLabel = startDay === today ? format(now, "dd MMM yyyy") : format(addDays(now, 1), "dd MMM yyyy");
      notifications.push({
        id: `emi-day-${debt.id}`,
        title: `${debt.name} EMI Due`,
        description: `Due: ${dueLabel} • EMI ₹${Number(debt.emi_amount || 0).toLocaleString("en-IN")} is due ${startDay === today ? "today" : "tomorrow"}`,
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
        description: `Due: ${carDueDate} • Car maintenance${cc.notify_at ? ` • ${format(notifyAt, "hh:mm a")}` : ""}`,
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
        description: `Due: ${goalDueDate} • Goal deadline • ${format(notifyAt, "hh:mm a")}`,
        type: "goal",
        date: format(notifyAt, "yyyy-MM-dd"),
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
      title: "💧 Drink Water",
      description: `You've had ${waterCount}/8 glasses today. Stay hydrated!`,
      type: "health",
      date: todayStr,
    });
  }
  if (breaksCount < 4) {
    notifications.push({
      id: "health-break",
      title: "☕ Take a Break",
      description: `${breaksCount}/4 breaks taken today. Rest your eyes & stretch!`,
      type: "health",
      date: todayStr,
    });
  }
  if (sleepHours === 0 && !healthLog) {
    notifications.push({
      id: "health-sleep",
      title: "😴 Log Your Sleep",
      description: "Don't forget to log last night's sleep hours!",
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
      localStorage.setItem("dismissed_notifications", JSON.stringify([...next]));
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setAllCleared(true);
    localStorage.setItem("all_notifications_cleared", "true");
  }, []);

  const typeColor = (type: Notification["type"]) => {
    switch (type) {
      case "emi": return "bg-destructive/10 text-destructive";
      case "reminder": return "bg-warning/10 text-warning";
      case "car_check": return "bg-primary/10 text-primary";
      case "goal": return "bg-success/10 text-success";
      case "health": return "bg-accent text-accent-foreground";
    }
  };

  const typeLabel = (type: Notification["type"]) => {
    switch (type) {
      case "emi": return "EMI";
      case "reminder": return "Reminder";
      case "car_check": return "Car Check";
      case "goal": return "Goal";
      case "health": return "Health";
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
          <h3 className="text-sm font-semibold">Notifications</h3>
          {visibleNotifications.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1" onClick={clearAll}>
              <CheckCheck className="h-3.5 w-3.5" /> Clear All
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto">
          {visibleNotifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No upcoming notifications
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
                  aria-label="Dismiss notification"
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
