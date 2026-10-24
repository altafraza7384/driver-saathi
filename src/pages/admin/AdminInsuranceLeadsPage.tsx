import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

// Admin-only insurance leads (English only, like all admin pages).
// Leads are NEVER public: Firestore rules allow read only by the owning
// user or an admin, and updates only by an admin — a user can never mark
// their own lead "converted" or set their own commission. The admin
// forwards leads to the licensed insurance partner (manually in Phase 1;
// an automated webhook comes after Blaze) and records the outcome +
// commission here so monthly reconciliation against the partner's
// statement is possible from lead IDs alone.
type InsuranceLead = {
  id: string;
  user_id?: string | null;
  name?: string | null;
  phone?: string | null;
  vehicle_number?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  city?: string | null;
  policy_expiry?: string | null;
  consent?: boolean | null;
  status?: string | null;
  commission_amount?: number | null;
  commission_note?: string | null;
  created_at?: string | null;
};

const STATUSES = ["all", "new", "contacted", "quoted", "converted", "rejected"] as const;

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  converted: "Policy Sold",
  rejected: "Rejected",
};

export default function AdminInsuranceLeadsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>("all");
  const [selected, setSelected] = useState<InsuranceLead | null>(null);
  const [status, setStatus] = useState("new");
  const [commission, setCommission] = useState("");
  const [note, setNote] = useState("");

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["admin_insurance_leads"],
    queryFn: async () => {
      const { data, error } = await db.from("insurance_leads").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as InsuranceLead[];
    },
  });

  const filtered = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  const converted = leads.filter((l) => l.status === "converted");
  const totalCommission = converted.reduce((sum, l) => sum + (Number(l.commission_amount) || 0), 0);

  const openLead = (l: InsuranceLead) => {
    setSelected(l);
    setStatus(l.status ?? "new");
    setCommission(l.commission_amount != null ? String(l.commission_amount) : "");
    setNote(l.commission_note ?? "");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const amount = commission.trim() === "" ? null : Number(commission);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        throw new Error("Commission must be a positive number or blank.");
      }
      // Commission on a new/rejected lead is stored but invisible in
      // "Commission Recorded" (which sums converted only) — gate it
      // (audit 2026-10-24).
      if (amount !== null && status !== "converted" && status !== "quoted") {
        throw new Error("Commission can only be recorded on converted or quoted leads.");
      }
      const { error } = await db
        .from("insurance_leads")
        .update({ status, commission_amount: amount, commission_note: note.trim() || null } as never)
        .eq("id", selected.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_insurance_leads"] });
      setSelected(null);
      toast.success("Lead updated!");
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  return (
    <div className="p-4 pt-6 space-y-4 max-w-2xl mx-auto">
      <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {"Back"}
      </button>

      <div>
        <h1 className="text-2xl font-bold">{"Insurance Leads"}</h1>
        <p className="text-sm text-muted-foreground">
          {"Private lead data — never public. Forward leads to the licensed insurance partner, then record the outcome and commission here for monthly reconciliation."}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold">{leads.length}</p><p className="text-xs text-muted-foreground">{"Total Leads"}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold">{converted.length}</p><p className="text-xs text-muted-foreground">{"Policies Sold"}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xl font-bold">₹{totalCommission.toLocaleString("en-IN")}</p><p className="text-xs text-muted-foreground">{"Commission Recorded"}</p></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : STATUS_LABELS[f]}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">{"No insurance leads yet."}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => (
            <Card key={l.id} className="cursor-pointer hover:bg-accent/40" onClick={() => openLead(l)}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Shield className="h-4 w-4" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{l.name ?? "—"} • {l.vehicle_model ?? "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {l.phone ?? "—"} • {l.city ?? "—"}
                        {l.commission_amount != null ? ` • ₹${l.commission_amount}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold">{STATUS_LABELS[l.status ?? ""] ?? (l.status ?? "—")}</p>
                    {l.created_at && <p className="text-[10px] text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{"Lead Details"}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <p><span className="text-muted-foreground">{"Name"}: </span>{selected.name ?? "—"}</p>
              <p><span className="text-muted-foreground">{"Phone"}: </span><a href={`tel:${selected.phone}`} className="text-primary">{selected.phone ?? "—"}</a></p>
              <p><span className="text-muted-foreground">{"Vehicle"}: </span>{selected.vehicle_number ?? "—"} • {selected.vehicle_model ?? "—"} {selected.vehicle_year ? `(${selected.vehicle_year})` : ""}</p>
              <p><span className="text-muted-foreground">{"City"}: </span>{selected.city ?? "—"}</p>
              <p><span className="text-muted-foreground">{"Policy expiry"}: </span>{selected.policy_expiry ?? "—"}</p>
              <p><span className="text-muted-foreground">{"Consent"}: </span>{selected.consent ? "Yes" : "No"}</p>
              <p><span className="text-muted-foreground">{"Lead ID"}: </span><span className="break-all">{selected.id}</span></p>
              <div>
                <Label htmlFor="lead-status">{"Status"}</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="lead-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="lead-commission">{"Commission (₹)"}</Label>
                <Input id="lead-commission" inputMode="numeric" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="lead-note">{"Note (partner / policy ref)"}</Label>
                <Input id="lead-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Broker statement ref" />
              </div>
              <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setSelected(null)}>{"Cancel"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
