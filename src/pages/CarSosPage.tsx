import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  BatteryCharging,
  CircleDot,
  HelpCircle,
  MapPin,
  Navigation,
  Phone,
  Star,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  ACTIVE_SOS_STATUSES,
  CAR_SOS_CATEGORIES,
  isValidPhone,
  newRequestId,
  splitLocation,
  type CarSosCategory,
  type CarSosRequest,
} from "@/lib/carSos";

const CATEGORY_ICONS: Record<CarSosCategory, typeof Wrench> = {
  tyre: CircleDot,
  mechanic: Wrench,
  battery: BatteryCharging,
  other: HelpCircle,
};

interface GpsFix {
  lat: number;
  lng: number;
}

// Location, best effort, three tiers:
// 1. Capacitor Geolocation plugin (native GPS in a fresh APK build)
// 2. Browser geolocation (works on the web app today)
// 3. Throws — the caller falls back to a typed area.
async function captureLocation(): Promise<GpsFix> {
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    // Fall through to browser geolocation.
  }
  if (navigator.geolocation) {
    return await new Promise<GpsFix>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject(new Error("gps")),
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  }
  throw new Error("gps");
}

export default function CarSosPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const statusLabel = (s: string) =>
    s === "pending" ? t("common.pending")
    : s === "accepted" ? t("common.accepted")
    : s === "onway" ? t("common.onTheWay")
    : s === "completed" ? t("common.completed")
    : s === "cancelled" ? t("common.cancelled")
    : s;
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<CarSosCategory | null>(null);
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [areaText, setAreaText] = useState("");
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [rating, setRating] = useState(0);

  const { data: requests = [] } = useQuery({
    queryKey: ["sos_requests", user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("sos_requests")
        .select("*")
        .eq("driverId", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CarSosRequest[];
    },
    enabled: !!user,
    refetchInterval: (query) => {
      const rows = query.state.data as CarSosRequest[] | undefined;
      const hasActive = rows?.some((r) =>
        ACTIVE_SOS_STATUSES.includes(r.status),
      );
      return hasActive ? 10000 : false;
    },
  });

  const active = requests.find((r) =>
    ACTIVE_SOS_STATUSES.includes(r.status),
  );
  const past = requests.filter(
    (r) => !ACTIVE_SOS_STATUSES.includes(r.status),
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["sos_requests", user?.id] });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!category) throw new Error("category");
      if (!isValidPhone(phone)) throw new Error("phone");
      if (!gps && !areaText.trim()) throw new Error("location");
      const id = newRequestId();
      const loc = gps ? splitLocation(gps.lat, gps.lng) : null;
      const { error: reqError } = await db.from("sos_requests").insert({
        id,
        driverId: user!.id,
        category,
        description: description.trim() || null,
        approxLat: loc ? loc.approxLat : null,
        approxLng: loc ? loc.approxLng : null,
        geohash: loc ? loc.geohash : null,
        areaText: areaText.trim() || null,
        status: "pending",
        mechanicId: null,
        mechanicName: null,
        mechanicPhone: null,
        chargesAgreed: null,
        rating: null,
      });
      if (reqError) throw reqError;
      // Private details doc: exact location + driver phone. Only the driver
      // and (after accept) the assigned mechanic may read it — see rules.
      const { error: detError } = await db
        .from("sos_request_details")
        .insert({
          id,
          requestId: id,
          driverId: user!.id,
          driverPhone: phone.replace(/\D/g, ""),
          exactLat: gps ? gps.lat : null,
          exactLng: gps ? gps.lng : null,
          mechanicId: null,
        });
      if (detError) {
        // Roll back the public request so no half-created SOS stays live.
        await db.from("sos_requests").delete().eq("id", id);
        throw detError;
      }
    },
    onSuccess: () => {
      invalidate();
      setCategory(null);
      setDescription("");
      setPhone("");
      setAreaText("");
      setGps(null);
      toast.success(t("carSos.requestSent"));
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("sos_requests")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success(t("carSos.cancelled"));
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("sos_requests")
        .update({ status: "completed", rating: rating || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setRating(0);
      invalidate();
      toast.success(t("carSos.completed"));
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const onGetLocation = async () => {
    setLocating(true);
    try {
      const fix = await captureLocation();
      setGps(fix);
      toast.success(t("carSos.locationCaptured"));
    } catch {
      toast.error(t("carSos.locationFailed"));
    } finally {
      setLocating(false);
    }
  };

  const statusText =
    active?.status === "pending"
      ? t("carSos.statusPending")
      : active?.status === "accepted"
        ? t("carSos.statusAccepted")
        : t("carSos.statusOnway");

  return (
    <div className="space-y-5 p-4 pt-6">
      <button
        onClick={() => navigate("/sos")}
        className="mb-2 flex items-center gap-1 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </button>
      <div>
        <h1 className="text-2xl font-bold">{t("carSos.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("carSos.subtitle")}</p>
      </div>

      {active ? (
        <div className="space-y-4">
          <Card className="border-primary/30">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {t(`carSos.${active.category}`)}
                </span>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {statusText}
                </span>
              </div>
              {active.description && (
                <p className="text-sm">{active.description}</p>
              )}
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {active.areaText ||
                  (active.approxLat !== null
                    ? `${active.approxLat}, ${active.approxLng}`
                    : "—")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("carSos.waitingNote")}
              </p>

              {active.mechanicName && (
                <div className="rounded-xl bg-muted p-3">
                  <p className="text-xs text-muted-foreground">
                    {t("carSos.mechanicLabel")}
                  </p>
                  <p className="font-semibold">{active.mechanicName}</p>
                  {active.chargesAgreed !== null && (
                    <p className="text-sm">₹{active.chargesAgreed}</p>
                  )}
                  {active.mechanicPhone && (
                    <a href={`tel:${active.mechanicPhone}`}>
                      <Button className="mt-2 w-full gap-2">
                        <Phone className="h-4 w-4" /> {t("carSos.call")} —{" "}
                        {active.mechanicPhone}
                      </Button>
                    </a>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                {active.status === "pending" && (
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => cancelMutation.mutate(active.id)}
                    disabled={cancelMutation.isPending}
                  >
                    {t("carSos.cancel")}
                  </Button>
                )}
                {active.status !== "pending" && (
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-1">
                      <span className="mr-1 text-xs text-muted-foreground">
                        {t("carSos.rate")}
                      </span>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onClick={() => setRating(n)}
                          aria-label={`Rate ${n}`}
                        >
                          <Star
                            className={`h-5 w-5 ${rating >= n ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                          />
                        </button>
                      ))}
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => completeMutation.mutate(active.id)}
                      disabled={completeMutation.isPending}
                    >
                      {t("carSos.complete")}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <Label>{t("carSos.category")}</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {CAR_SOS_CATEGORIES.map((c) => {
                  const Icon = CATEGORY_ICONS[c];
                  return (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-medium ${
                        category === c
                          ? "border-primary bg-primary/10 text-primary"
                          : "bg-muted"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {t(`carSos.${c}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label>{t("carSos.description")}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div>
              <Label>{t("carSos.phone")}</Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 9876543210"
              />
            </div>

            <div className="space-y-2">
              <Label>{t("carSos.location")}</Label>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={onGetLocation}
                disabled={locating}
              >
                <Navigation className="h-4 w-4" />
                {locating ? t("common.saving") : t("carSos.getLocation")}
              </Button>
              {gps && (
                <p className="text-xs text-muted-foreground">
                  {t("carSos.locationCaptured")}: {gps.lat.toFixed(4)},{" "}
                  {gps.lng.toFixed(4)}
                </p>
              )}
              <Input
                value={areaText}
                onChange={(e) => setAreaText(e.target.value)}
                placeholder={t("carSos.area")}
              />
            </div>

            <Button
              className="w-full"
              onClick={() => sendMutation.mutate()}
              disabled={
                !category || !isValidPhone(phone) || (!gps && !areaText.trim()) || sendMutation.isPending
              }
            >
              {sendMutation.isPending ? t("common.saving") : t("carSos.sendRequest")}
            </Button>
          </CardContent>
        </Card>
      )}

      {past.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold">{t("carSos.history")}</h2>
          {past.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-medium">
                    {t(`carSos.${r.category}`)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {statusLabel(r.status)} •{" "}
                    {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                {r.rating ? (
                  <span className="flex items-center gap-1 text-sm">
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    {r.rating}
                  </span>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
