import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { localToday } from "@/lib/budgets";
import { db } from "@/lib/backend";

interface Announcement {
  id: string;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  audience?: string | null;
  is_active?: boolean | null;
  expires_at?: string | null;
  image_url?: string | null;
  created_at?: string | null;
}

function readSeen(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {}
}

export default function AnnouncementPopup() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [popupSeen, setPopupSeen] = useState<Set<string>>(() => readSeen("announcement_popup_seen"));
  const [showImage, setShowImage] = useState(true);

  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await db
        .from("announcements")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data as Announcement[];
    },
  });

  const { data: myPlan } = useQuery({
    queryKey: ["announcements_my_plan"],
    queryFn: async () => {
      try {
        const { data } = await db.from("users").select("*").eq("id", user!.id);
        const row = Array.isArray(data) ? data[0] : data;
        return (row as { subscription_plan_id: string | null } | null)?.subscription_plan_id ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!user,
  });

  const today = localToday();
  const visible = announcements.filter((a) => {
    if (!a.is_active) return false;
    if (a.expires_at && a.expires_at < today) return false;
    if (a.audience === "non_subscribers" && myPlan) return false;
    return true;
  });
  const popupAnnouncement = visible.find((a) => !popupSeen.has(a.id));

  useEffect(() => {
    setShowImage(true);
  }, [popupAnnouncement?.id]);

  const markSeen = (id: string) => {
    const next = new Set(popupSeen);
    next.add(id);
    setPopupSeen(next);
    writeSeen("announcement_popup_seen", next);
  };

  const handleClose = () => {
    if (popupAnnouncement) markSeen(popupAnnouncement.id);
  };

  const handleOfferClick = () => {
    if (popupAnnouncement) markSeen(popupAnnouncement.id);
    navigate("/more");
  };

  if (!popupAnnouncement) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background" role="dialog" aria-modal="true">
      <Button variant="ghost" size="icon" className="absolute right-4 top-4 z-10" onClick={handleClose}>
        <X className="h-4 w-4" />
      </Button>
      {popupAnnouncement.image_url && showImage && (
        <div className="w-full shrink-0">
          <img
            src={popupAnnouncement.image_url}
            alt=""
            loading="lazy"
            onError={() => setShowImage(false)}
            className="w-full object-cover"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col justify-center gap-4 p-6">
        <h2 className="text-2xl font-bold">{popupAnnouncement.title ?? "Driver Saathi"}</h2>
        <p className="whitespace-pre-wrap text-muted-foreground">{popupAnnouncement.message ?? ""}</p>
        {popupAnnouncement.type === "offer" && (
          <Button className="w-full" onClick={handleOfferClick}>
            {t("announcement.viewPlans")}
          </Button>
        )}
        <Button variant="outline" className="w-full" onClick={handleClose}>
          {t("announcement.close")}
        </Button>
      </div>
    </div>
  );
}
