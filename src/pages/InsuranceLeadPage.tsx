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
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { ArrowLeft, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

// Phase 1 insurance leads (user decision 2026-10-22): Driver Saathi does
// NOT sell insurance and never collects a premium. The user shares contact
// details ONCE, with explicit consent, for a quote from a licensed
// insurance partner; the partner does the solicitation, quoting and sale,
// and pays Driver Saathi a lead/marketing fee under a written agreement.
// Leads live in the private `insurance_leads` collection: readable only
// by the owner and by admins (see firestore.rules) — never public, never
// in a marketplace post. No OTP is sent for a lead in Phase 1; quality is
// protected by a 10-digit check + a 30-day duplicate block below.
type InsuranceLead = {
  id: string;
  name?: string | null;
  phone?: string | null;
  vehicle_number?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  city?: string | null;
  policy_expiry?: string | null;
  status?: string | null;
  created_at?: string | null;
};

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits;
}

export default function InsuranceLeadPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    vehicle_number: "",
    vehicle_model: "",
    vehicle_year: "",
    city: "",
    policy_expiry: "",
  });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  // Form-sheet pattern (Phase 6, presentation only): the existing
  // validation messages are mapped to their field and shown beneath it
  // in a reserved slot, in addition to the toast. Labels were already
  // linked, and form values are retained on failure (only success clears).
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string; vehicle_number?: string; vehicle_year?: string; vehicle_model?: string; city?: string; policy_expiry?: string; consent?: string }>({});
  const clearFieldError = (key: keyof typeof fieldErrors) => setFieldErrors((prev) => ({ ...prev, [key]: undefined }));

  const { data: myLeads = [], isLoading: leadsLoading, isError: leadsError, refetch: refetchLeads } = useQuery({
    queryKey: ["insurance_leads_mine"],
    queryFn: async () => {
      const { data, error } = await db
        .from("insurance_leads")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as InsuranceLead[];
    },
    enabled: !!user,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const phone = normalizePhone(form.phone);
      if (!form.name.trim() || !form.vehicle_model.trim() || !form.city.trim()) {
        throw new Error(t("insurance.required"));
      }
      if (!/^[6-9]\d{9}$/.test(phone)) {
        throw new Error(t("insurance.invalidPhone"));
      }
      if (!consent) {
        throw new Error(t("insurance.consentRequired"));
      }
      // Vehicle year must be a plausible 4-digit year, and a policy
      // expiry in the past is useless to a broker (audit 2026-10-24:
      // "abc"/"1800"/past dates were all accepted).
      const year = form.vehicle_year.trim();
      const thisYear = new Date().getFullYear();
      if (year && !/^\d{4}$/.test(year)) {
        throw new Error(t("insurance.invalidYear"));
      }
      if (year && (Number(year) < 1980 || Number(year) > thisYear + 1)) {
        throw new Error(t("insurance.invalidYear"));
      }
      if (form.policy_expiry) {
        const todayStr = `${thisYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
        if (form.policy_expiry < todayStr) {
          throw new Error(t("insurance.pastExpiry"));
        }
      }
      // 30-day duplicate block on the same phone + vehicle number (or
      // phone alone when no vehicle number was given): brokers pay only
      // for qualified, non-duplicate leads, so never create a second one.
      // A REJECTED lead does not block a corrected resubmission (audit
      // 2026-10-24): a mistyped vehicle number otherwise locked the user
      // out for 30 days with no edit/delete path.
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const dup = myLeads.some((l) => {
        if (l.status === "rejected") return false;
        if (normalizePhone(l.phone ?? "") !== phone) return false;
        if (!l.created_at || new Date(l.created_at).getTime() < cutoff) return false;
        const oldVehicle = (l.vehicle_number ?? "").trim().toUpperCase();
        const newVehicle = form.vehicle_number.trim().toUpperCase();
        if (!oldVehicle && !newVehicle) return true;
        return oldVehicle === newVehicle;
      });
      if (dup) throw new Error(t("insurance.duplicate"));
      const { error } = await db.from("insurance_leads").insert({
        user_id: user.id,
        name: form.name.trim(),
        phone,
        vehicle_number: form.vehicle_number.trim().toUpperCase() || null,
        vehicle_model: form.vehicle_model.trim(),
        vehicle_year: form.vehicle_year.trim() || null,
        city: form.city.trim(),
        policy_expiry: form.policy_expiry || null,
        consent: true,
        status: "new",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance_leads_mine"] });
      setForm({
        name: "",
        phone: "",
        vehicle_number: "",
        vehicle_model: "",
        vehicle_year: "",
        city: "",
        policy_expiry: "",
      });
      setConsent(false);
      setError("");
      setFieldErrors({});
      toast.success(t("insurance.success"));
    },
    onError: (e: Error) => {
      const msg = friendlyErrorMessage(e);
      setError("");
      if (msg === t("insurance.required")) setFieldErrors({ name: msg, vehicle_model: msg, city: msg });
      else if (msg === t("insurance.invalidPhone")) setFieldErrors({ phone: msg });
      else if (msg === t("insurance.consentRequired")) setFieldErrors({ consent: msg });
      else if (msg === t("insurance.invalidYear")) setFieldErrors({ vehicle_year: msg });
      else if (msg === t("insurance.pastExpiry")) setFieldErrors({ policy_expiry: msg });
      else if (msg === t("insurance.duplicate")) setFieldErrors({ phone: msg, vehicle_number: msg });
      else setError(msg);
      toast.error(msg);
    },
  });

  const statusLabel = (s: string | null | undefined) =>
    s ? t(`insurance.status.${s}`) : "—";

  return (
    <div className="space-y-5 p-4 pt-6 max-w-2xl mx-auto">
      <button onClick={() => navigate("/car-checks")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </button>

      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{t("insurance.title")}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t("insurance.cardDesc")}</p>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <Label htmlFor="ins-name">{t("insurance.name")}</Label>
            <Input id="ins-name" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); clearFieldError("name"); }} />
            <p className="min-h-5 text-sm text-destructive">{fieldErrors.name ?? ""}</p>
          </div>
          <div>
            <Label htmlFor="ins-phone">{t("insurance.phone")}</Label>
            <Input id="ins-phone" type="tel" inputMode="numeric" value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); clearFieldError("phone"); }} placeholder="9876543210" />
            <p className="min-h-5 text-sm text-destructive">{fieldErrors.phone ?? ""}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ins-vehicle-number">{t("insurance.vehicleNumber")}</Label>
              <Input id="ins-vehicle-number" value={form.vehicle_number} onChange={(e) => { setForm({ ...form, vehicle_number: e.target.value }); clearFieldError("vehicle_number"); }} placeholder="MH02AB1234" />
              <p className="min-h-5 text-sm text-destructive">{fieldErrors.vehicle_number ?? ""}</p>
            </div>
            <div>
              <Label htmlFor="ins-vehicle-year">{t("insurance.vehicleYear")}</Label>
              <Input id="ins-vehicle-year" inputMode="numeric" value={form.vehicle_year} onChange={(e) => { setForm({ ...form, vehicle_year: e.target.value }); clearFieldError("vehicle_year"); }} placeholder="2021" />
              <p className="min-h-5 text-sm text-destructive">{fieldErrors.vehicle_year ?? ""}</p>
            </div>
          </div>
          <div>
            <Label htmlFor="ins-vehicle-model">{t("insurance.vehicleModel")}</Label>
            <Input id="ins-vehicle-model" value={form.vehicle_model} onChange={(e) => { setForm({ ...form, vehicle_model: e.target.value }); clearFieldError("vehicle_model"); }} placeholder="Swift VXi" />
            <p className="min-h-5 text-sm text-destructive">{fieldErrors.vehicle_model ?? ""}</p>
          </div>
          <div>
            <Label htmlFor="ins-city">{t("insurance.city")}</Label>
            <Input id="ins-city" value={form.city} onChange={(e) => { setForm({ ...form, city: e.target.value }); clearFieldError("city"); }} placeholder="Mumbai" />
            <p className="min-h-5 text-sm text-destructive">{fieldErrors.city ?? ""}</p>
          </div>
          <div>
            <Label htmlFor="ins-expiry">{t("insurance.policyExpiry")}</Label>
            <DatePicker id="ins-expiry" label={t("insurance.policyExpiry")} value={form.policy_expiry} onChange={(value) => { setForm({ ...form, policy_expiry: value }); clearFieldError("policy_expiry"); }} placeholder={t("insurance.policyExpiry")} />
            <p className="min-h-5 text-sm text-destructive">{fieldErrors.policy_expiry ?? ""}</p>
          </div>
          <div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={consent} onCheckedChange={(v) => { setConsent(v === true); clearFieldError("consent"); }} />
              <span>{t("insurance.consent")}</span>
            </label>
            <p className="min-h-5 text-sm text-destructive">{fieldErrors.consent ?? ""}</p>
          </div>
          <div className="pt-1">
            <p className="min-h-5 text-sm text-destructive">{error}</p>
            <Button className="w-full" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending || leadsLoading}>
              {submitMutation.isPending ? t("insurance.submitting") : t("insurance.submit")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("insurance.disclaimer")}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="font-bold">{t("insurance.myRequests")}</h2>
        {leadsError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium">{t("home.loadError")}</p>
            <button
              className="mt-1 font-medium text-primary underline"
              onClick={() => refetchLeads()}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : myLeads.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("insurance.noRequests")}</p>
        ) : (
          myLeads.map((l) => (
            <Card key={l.id}>
              <CardContent className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{l.vehicle_model ?? "—"} • {l.city ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.created_at ? new Date(l.created_at).toLocaleDateString() : "—"}
                    {l.policy_expiry ? ` • Expiry: ${l.policy_expiry}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-semibold">{statusLabel(l.status)}</span>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
