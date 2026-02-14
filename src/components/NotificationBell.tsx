import { useState } from "react";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, isToday, isTomorrow, parseISO, isBefore, addDays } from "date-fns";

interface Notification {
  id: string;
  title: string;
  description: string;
  type: "reminder" | "emi" | "car_check" | "goal";
  date: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
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

  const notifications: Notification[] = [];

  const formatDueLabel = (d: Date) =>
    isToday(d) ? "Due today" : isTomorrow(d) ? "Due tomorrow" : `Due ${format(d, "MMM dd")}`;

  // Reminders with notify_at
  reminders.forEach((r: any) => {
    const notifyAt = r.notify_at ? parseISO(r.notify_at) : parseISO(r.reminder_date);
    if (isBefore(notifyAt, twoDaysLater)) {
      notifications.push({
        id: `rem-${r.id}`,
        title: r.title,
        description: `${formatDueLabel(notifyAt)} • ${r.category}${r.notify_at ? ` • ${format(notifyAt, "hh:mm a")}` : ""}`,
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
        notifications.push({
          id: `emi-${debt.id}`,
          title: `${debt.name} EMI Due`,
          description: `${formatDueLabel(notifyAt)} • ₹${Number(debt.emi_amount || 0).toLocaleString("en-IN")} • ${format(notifyAt, "hh:mm a")}`,
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
      notifications.push({
        id: `emi-day-${debt.id}`,
        title: `${debt.name} EMI Due`,
        description: `EMI of ₹${Number(debt.emi_amount || 0).toLocaleString("en-IN")} is due ${startDay === today ? "today" : "tomorrow"}`,
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
      notifications.push({
        id: `car-${cc.id}`,
        title: cc.check_type,
        description: `${formatDueLabel(notifyAt)} - Car maintenance${cc.notify_at ? ` • ${format(notifyAt, "hh:mm a")}` : ""}`,
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
      notifications.push({
        id: `goal-${g.id}`,
        title: g.title,
        description: `${formatDueLabel(notifyAt)} - Goal deadline • ${format(notifyAt, "hh:mm a")}`,
        type: "goal",
        date: format(notifyAt, "yyyy-MM-dd"),
      });
    }
  });

  const count = notifications.length;

  const typeColor = (type: Notification["type"]) => {
    switch (type) {
      case "emi": return "bg-destructive/10 text-destructive";
      case "reminder": return "bg-warning/10 text-warning";
      case "car_check": return "bg-primary/10 text-primary";
      case "goal": return "bg-success/10 text-success";
    }
  };

  const typeLabel = (type: Notification["type"]) => {
    switch (type) {
      case "emi": return "EMI";
      case "reminder": return "Reminder";
      case "car_check": return "Car Check";
      case "goal": return "Goal";
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
        <div className="border-b p-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No upcoming notifications
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 border-b p-3 last:border-0">
                <div className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${typeColor(n.type)}`}>
                  {typeLabel(n.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.description}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
