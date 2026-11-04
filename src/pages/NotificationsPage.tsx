import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, X, AlertTriangle, Calendar, CreditCard, Car, Target, Heart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications, useCarDocuments, useCarChecks, useGoals, useHealthLogs, useDebts } from "@/hooks/useQueries";
import { useLanguage } from "@/lib/i18n";
import { parseISO, isBefore, addDays, differenceInDays, format } from "date-fns";

interface NotificationItem {
  id: string;
  type: "reminder" | "debt" | "carCheck" | "document" | "goal" | "health";
  title: string;
  description: string;
}

const getIcon = (type: string) => {
  switch (type) {
    case "reminder": return <Calendar className="h-4 w-4" />;
    case "debt": return <CreditCard className="h-4 w-4" />;
    case "carCheck": return <Car className="h-4 w-4" />;
    case "document": return <AlertTriangle className="h-4 w-4" />;
    case "goal": return <Target className="h-4 w-4" />;
    case "health": return <Heart className="h-4 w-4" />;
    default: return <Bell className="h-4 w-4" />;
  }
};

const getColor = (type: string) => {
  switch (type) {
    case "reminder": return "text-blue-500";
    case "debt": return "text-red-500";
    case "carCheck": return "text-orange-500";
    case "document": return "text-yellow-500";
    case "goal": return "text-green-500";
    case "health": return "text-pink-500";
    default: return "text-muted-foreground";
  }
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [allCleared, setAllCleared] = useState(false);

  const { data: reminders = [] } = useNotifications(user?.id);
  const { data: debts = [] } = useDebts(user?.id);
  const { data: carChecks = [] } = useCarChecks(user?.id);
  const { data: carDocuments = [] } = useCarDocuments(user?.id);
  const { data: goals = [] } = useGoals(user?.id);
  const { data: healthLogs = [] } = useHealthLogs(user?.id);

  useEffect(() => {
    const today = new Date().toDateString();
    const dismissed = localStorage.getItem("dismissed_notifications");
    if (dismissed) {
      const { date, ids } = JSON.parse(dismissed);
      if (date === today) {
        setDismissedIds(new Set(ids));
      }
    }
    const cleared = localStorage.getItem("all_notifications_cleared");
    if (cleared) {
      const { date } = JSON.parse(cleared);
      if (date === today) {
        setAllCleared(true);
      }
    }
  }, []);

  const handleDismiss = (id: string) => {
    const newDismissed = new Set(dismissedIds);
    newDismissed.add(id);
    setDismissedIds(newDismissed);
    localStorage.setItem("dismissed_notifications", JSON.stringify({
      date: new Date().toDateString(),
      ids: Array.from(newDismissed),
    }));
  };

  const handleClearAll = () => {
    setAllCleared(true);
    localStorage.setItem("all_notifications_cleared", JSON.stringify({
      date: new Date().toDateString(),
    }));
  };

  const notifications: NotificationItem[] = [];
  const now = new Date();
  const twoDaysLater = addDays(now, 2);

  reminders.forEach((reminder) => {
    const notifyAt = parseISO(reminder.notifyAt);
    if (isBefore(notifyAt, twoDaysLater)) {
      notifications.push({
        id: `reminder-${reminder.id}`,
        type: "reminder",
        title: reminder.title,
        description: `${t("notif.reminderDue")} ${format(notifyAt, "dd MMM")}`,
      });
    }
  });

  debts.forEach((debt) => {
    const due = parseISO(debt.dueDate);
    if (isBefore(due, twoDaysLater) && !isBefore(due, addDays(now, -1))) {
      notifications.push({
        id: `debt-${debt.id}`,
        type: "debt",
        title: `${t("notif.debtDue")}: ${debt.person}`,
        description: `\u20B9${debt.amount} ${t("notif.dueOn")} ${format(due, "dd MMM")}`,
      });
    }
  });

  carChecks.forEach((check) => {
    const nextCheck = parseISO(check.nextCheckDate);
    if (isBefore(nextCheck, twoDaysLater) && !isBefore(nextCheck, addDays(now, -1))) {
      notifications.push({
        id: `carCheck-${check.id}`,
        type: "carCheck",
        title: `${t("notif.carCheckDue")}: ${check.item}`,
        description: `${check.vehicleName} - ${format(nextCheck, "dd MMM")}`,
      });
    }
  });

  carDocuments.forEach((doc) => {
    const daysLeft = differenceInDays(parseISO(doc.expiryDate), new Date());
    if (daysLeft <= 30) {
      notifications.push({
        id: `document-${doc.id}`,
        type: "document",
        title: `${t("notif.docExpiring")}: ${doc.type}`,
        description: `${doc.vehicleName} - ${daysLeft} ${t("notif.daysLeft")}`,
      });
    }
  });

  goals.forEach((goal) => {
    const target = parseISO(goal.targetDate);
    if (isBefore(target, twoDaysLater) && !isBefore(target, addDays(now, -1))) {
      notifications.push({
        id: `goal-${goal.id}`,
        type: "goal",
        title: `${t("notif.goalDeadline")}: ${goal.title}`,
        description: `\u20B9${goal.currentAmount} / \u20B9${goal.targetAmount} - ${format(target, "dd MMM")}`,
      });
    }
  });

  const todayStr = now.toISOString().split("T")[0];
  const todayLogs = healthLogs.filter((log) => log.date === todayStr);
  if (todayLogs.length === 0) {
    notifications.push({
      id: "health-daily",
      type: "health",
      title: t("notif.healthReminder"),
      description: t("notif.healthReminderDesc"),
    });
  }

  const visibleNotifications = allCleared ? [] : notifications.filter((n) => !dismissedIds.has(n.id));

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5" />
            {t("notif.title")}
          </h1>
          {visibleNotifications.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearAll} className="ml-auto text-xs">
              <Trash2 className="h-3 w-3 mr-1" />
              {t("notif.clearAll")}
            </Button>
          )}
        </div>

        {visibleNotifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Bell className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("notif.empty")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleNotifications.map((notification) => (
              <div key={notification.id} className="flex gap-3 p-3 rounded-lg border">
                <div className={`mt-0.5 ${getColor(notification.type)}`}>{getIcon(notification.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="text-xs text-muted-foreground">{notification.description}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handleDismiss(notification.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
