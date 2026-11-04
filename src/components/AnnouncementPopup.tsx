import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { db } from "@/lib/backend";

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: string;
  audience: string;
  is_active: boolean;
  expires_at: string | null;
  image_url?: string | null;
  created_at: string;
}

export default function AnnouncementPopup() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [seenIds, setSeenIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("announcement_popup_seen");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [showImage, setShowImage] = useState(true);

  const { data: announcements } = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await db
        .from("announcements")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Announcement[];
    },
  });

  const { data: myPlan } = useQuery({
    queryKey: ["announcements_my_plan"],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await db
        .from("user_subscriptions")
        .select("status, current_period_end")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const isSubscriber =
    myPlan?.status === "active" &&
    (!myPlan.current_period_end || new Date(myPlan.current_period_end) > new Date());

  const popupAnnouncement = announcements?.find((a) => {
    if (!a.is_active) return false;
    if (a.expires_at && new Date(a.expires_at) < new Date()) return false;
    if (a.audience === "non_subscribers" && isSubscriber) return false;
    if (seenIds.includes(a.id)) return false;
    return true;
  });

  useEffect(() => {
    setShowImage(true);
  }, [popupAnnouncement?.id]);

  const markSeen = (id: string) => {
    const next = [...seenIds, id];
    setSeenIds(next);
    try {
      localStorage.setItem("announcement_popup_seen", JSON.stringify(next));
    } catch {
      // Ignore storage failures; the popup simply may show again.
    }
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
        <h2 className="text-2xl font-bold">{popupAnnouncement.title}</h2>
        <p className="whitespace-pre-wrap text-muted-foreground">{popupAnnouncement.message}</p>
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
