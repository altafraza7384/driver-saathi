import { useState } from "react";
import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, addDays, isSameDay, isToday, isTomorrow, parseISO } from "date-fns";

interface Notification {
  id: string;
  title: string;
  description: string;
  type: "reminder" | "emi" | "car_check";
  date: string;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const today = new Date();
  const tomorrow = addDays(today, 1);

  const { data: reminders = [] } = useQuery({
    queryKey: ["notifications_reminders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("reminders")
        .select("*")
        .eq("is_completed", false)
        .gte("reminder_date", format(today, "yyyy-MM-dd"))
        .lte("reminder_date", format(addDays(today, 2), "yyyy-MM-dd"));
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
        .select("*")
        .eq("is_completed", false)
        .not("next_due_date", "is", null)
        .gte("next_due_date", format(today, "yyyy-MM-dd"))
        .lte("next_due_date", format(addDays(today, 2), "yyyy-MM-dd"));
      return data ?? [];
    },
    enabled: !!user,
  });

  // Build notifications
  const notifications: Notification[] = [];

  // Reminders due today/tomorrow
  reminders.forEach((r) => {
    const d = parseISO(r.reminder_date);
    const label = isToday(d) ? "Due today" : isTomorrow(d) ? "Due tomorrow" : `Due ${format(d, "MMM dd")}`;
    notifications.push({
      id: `rem-${r.id}`,
      title: r.title,
      description: `${label} • ${r.category}`,
      type: "reminder",
      date: r.reminder_date,
    });
  });

  // EMI due dates - check if start_date day matches today or tomorrow
  debts.forEach((debt) => {
    const startDay = parseISO(debt.start_date).getDate();
    const todayDate = today.getDate();
    const tomorrowDate = tomorrow.getDate();
    if (startDay === todayDate) {
      notifications.push({
        id: `emi-today-${debt.id}`,
        title: `${debt.name} EMI Due`,
        description: `EMI of ₹${Number(debt.emi_amount || 0).toLocaleString("en-IN")} is due today`,
        type: "emi",
        date: format(today, "yyyy-MM-dd"),
      });
    } else if (startDay === tomorrowDate) {
      notifications.push({
        id: `emi-tmrw-${debt.id}`,
        title: `${debt.name} EMI Due Tomorrow`,
        description: `EMI of ₹${Number(debt.emi_amount || 0).toLocaleString("en-IN")} is due tomorrow`,
        type: "emi",
        date: format(tomorrow, "yyyy-MM-dd"),
      });
    }
  });

  // Car checks due
  carChecks.forEach((cc) => {
    if (!cc.next_due_date) return;
    const d = parseISO(cc.next_due_date);
    const label = isToday(d) ? "Due today" : isTomorrow(d) ? "Due tomorrow" : `Due ${format(d, "MMM dd")}`;
    notifications.push({
      id: `car-${cc.id}`,
      title: `${cc.check_type}`,
      description: `${label} - Car maintenance`,
      type: "car_check",
      date: cc.next_due_date,
    });
  });

  const count = notifications.length;

  const typeColor = (type: Notification["type"]) => {
    switch (type) {
      case "emi": return "bg-destructive/10 text-destructive";
      case "reminder": return "bg-warning/10 text-warning";
      case "car_check": return "bg-primary/10 text-primary";
    }
  };

  const typeLabel = (type: Notification["type"]) => {
    switch (type) {
      case "emi": return "EMI";
      case "reminder": return "Reminder";
      case "car_check": return "Car Check";
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
