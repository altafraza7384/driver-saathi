import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Megaphone, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Admin announcements (in-app, works WITHOUT Blaze — see the staged push
// function in firebase/functions for the closed-app native push, which
// deploys only after Blaze). An announcement is shown on Home as a banner
// AND once as a popup dialog. Both have a close option, by the user's
// explicit requirement:
//  - Popup close (X or Close button) marks that announcement "popup seen"
//    in localStorage, so it never pops up again for that user — but the
//    banner keeps showing until the admin deactivates it or it expires.
//  - Banner close (X) hides that announcement's banner for that user
//    (localStorage), without touching the popup-seen state.
// Announcement text is admin-entered and shown exactly as written (like
// other user-entered titles); only the Close / View Plans buttons use t().
type Announcement = {
  id: string;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  audience?: string | null;
  is_active?: boolean | null;
  expires_at?: string | null;
  created_at?: string | null;
};

function readSeen(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeSeen(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Private mode / full storage: banners still render, popups may repeat.
  }
}

export function AnnouncementBanner() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [popupSeen, setPopupSeen] = useState<Set<string>>(() => readSeen("announcement_popup_seen"));
  const [bannerDismissed, setBannerDismissed] = useState<Set<string>>(() => readSeen("announcement_banner_dismissed"));
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupId, setPopupId] = useState<string | null>(null);

  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await db.from("announcements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Announcement[];
    },
    enabled: !!user,
  });

  // The current user's plan: users/{uid}.subscription_plan_id is null when
  // the user has no plan (see AdminUsersPage). Fail-open for marketing:
  // if the profile cannot be read, offer announcements still show — a
  // subscriber seeing an offer is harmless, a non-subscriber missing one
  // loses a sale. This read never gates anything security-sensitive:
  // announcements themselves are public to signed-in users by rules.
  const { data: myPlan } = useQuery({
    queryKey: ["announcements_my_plan"],
    queryFn: async () => {
      try {
        const { data } = await db.from("users").select("*").eq("id", user!.id);
        const row = Array.isArray(data) ? data[0] : data;
        return (row as { subscription_plan_id?: string | null } | null)?.subscription_plan_id ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!user,
  });

  const today = new Date().toISOString().slice(0, 10);
  const visible = useMemo(
    () =>
      announcements.filter((a) => {
        if (!a.is_active) return false;
        if (a.expires_at && a.expires_at < today) return false;
        if (a.audience === "non_subscribers" && myPlan) return false;
        return true;
      }),
    [announcements, myPlan, today]
  );

  const bannerItems = visible.filter((a) => !bannerDismissed.has(a.id));
  const popupCandidate = visible.find((a) => !popupSeen.has(a.id));

  useEffect(() => {
    if (popupCandidate && !popupOpen) {
      setPopupId(popupCandidate.id);
      setPopupOpen(true);
    }
  }, [popupCandidate, popupOpen]);

  const closePopup = () => {
    setPopupOpen(false);
    if (popupId) {
      const next = new Set(popupSeen);
      next.add(popupId);
      setPopupSeen(next);
      writeSeen("announcement_popup_seen", next);
    }
    setPopupId(null);
  };

  const dismissBanner = (id: string) => {
    const next = new Set(bannerDismissed);
    next.add(id);
    setBannerDismissed(next);
    writeSeen("announcement_banner_dismissed", next);
  };

  const popupAnnouncement = popupId ? visible.find((a) => a.id === popupId) ?? null : null;

  return (
    <>
      {bannerItems.length > 0 && (
        <div className="space-y-2">
          {bannerItems.map((a) => (
            <Card key={a.id} className="border-primary/30 bg-primary/5">
              <CardContent className="p-3 flex items-start gap-2">
                <Megaphone className="h-5 w-5 shrink-0 mt-0.5 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm">{a.title ?? "Driver Saathi"}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{a.message ?? ""}</p>
                  {a.type === "offer" && (
                    <Button size="sm" className="mt-2" onClick={() => navigate("/more")}>
                      {t("announcement.viewPlans")}
                    </Button>
                  )}
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={t("announcement.close")} onClick={() => dismissBanner(a.id)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={popupOpen && !!popupAnnouncement} onOpenChange={(o) => !o && closePopup()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{popupAnnouncement?.title ?? "Driver Saathi"}</DialogTitle>
          </DialogHeader>
          {popupAnnouncement && (
            <div className="space-y-4">
              <p className="text-sm whitespace-pre-wrap">{popupAnnouncement.message ?? ""}</p>
              <div className="flex gap-2">
                {popupAnnouncement.type === "offer" && (
                  <Button
                    className="flex-1"
                    onClick={() => {
                      closePopup();
                      navigate("/more");
                    }}
                  >
                    {t("announcement.viewPlans")}
                  </Button>
                )}
                <Button variant="outline" className="flex-1" onClick={closePopup}>
                  {t("announcement.close")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
