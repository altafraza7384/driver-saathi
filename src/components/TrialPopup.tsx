import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { getTrialState, trialMilestone } from "@/lib/trial";

// Trial milestone popup, mounted once in AppLayout. Shows at most once per
// calendar day (localStorage date gate), only when 1–2 days are left or the
// trial has expired, every day until the user buys a plan — never for paid
// users or admins, never blocks the app — "Baad me" just closes it.
export function TrialPopup() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [milestone, setMilestone] = useState<"2days" | "lastDay" | "expired" | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["trial_profile"],
    queryFn: async () => {
      const { data } = await db.from("users").select("*").eq("id", user!.id);
      const row = Array.isArray(data) ? data[0] : data;
      return row as { subscription_plan_id?: string | null; trial_ends_at?: unknown } | null;
    },
    enabled: !!user,
  });

  const { data: roleRows } = useQuery({
    queryKey: ["trial_roles"],
    queryFn: async () => {
      try {
        const { data } = await db.from("roles").select("*").eq("id", user!.id);
        const row = Array.isArray(data) ? data[0] : data;
        return (row as { roles?: string[] } | null)?.roles ?? [];
      } catch {
        return [];
      }
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!profile || !roleRows) return;
    if (roleRows.includes("admin")) return;
    // Owner's rule: popup only when 1–2 days are left, or after expiry —
    // at most ONCE per calendar day, every day until the user buys a plan.
    // Paid users never see it (getTrialState returns "paid" → no milestone).
    const m = trialMilestone(getTrialState(profile));
    if (!m) return;
    const key = `ds-trial-popup-${new Date().toISOString().slice(0, 10)}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    setMilestone(m);
    setOpen(true);
  }, [profile, roleRows]);

  if (!milestone) return null;

  const title =
    milestone === "2days" ? t("trial.popup2daysTitle")
    : milestone === "lastDay" ? t("trial.popupLastDayTitle")
    : t("trial.popupExpiredTitle");
  const body =
    milestone === "2days" ? t("trial.popup2daysBody")
    : milestone === "lastDay" ? t("trial.popupLastDayBody")
    : t("trial.popupExpiredBody");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogTitle>{title}</DialogTitle>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => {
              setOpen(false);
              navigate("/more");
            }}
          >
            {t("trial.viewPlans")}
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
            {t("trial.later")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
