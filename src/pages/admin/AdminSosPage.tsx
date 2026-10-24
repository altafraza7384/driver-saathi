import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Siren } from "lucide-react";
import { useNavigate } from "react-router-dom";

type SosRequest = {
  id: string;
  driverId?: string | null;
  category?: string | null;
  description?: string | null;
  areaText?: string | null;
  approxLat?: number | null;
  approxLng?: number | null;
  status?: string | null;
  mechanicId?: string | null;
  mechanicName?: string | null;
  mechanicPhone?: string | null;
  chargesAgreed?: number | null;
  rating?: number | null;
  created_at?: string | null;
};

const FILTERS = ["all", "pending", "accepted", "onway", "completed", "cancelled"] as const;

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  onway: "On the way",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function AdminSosPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [selected, setSelected] = useState<SosRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["admin_sos"],
    queryFn: async () => {
      const { data, error } = await db.from("sos_requests").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as SosRequest[];
    },
  });

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);
  const statusLabel = (s: string | null | undefined) => (s && STATUS_LABELS[s] ? STATUS_LABELS[s] : (s ?? "—"));

  // Admin-only read of the private details doc (driver phone + exact
  // location) for dispute/mediation. The rules grant isAdmin() read on
  // sos_request_details (audit 2026-10-24); without the rules change
  // this query fails closed and the section simply stays empty.
  const { data: details } = useQuery({
    queryKey: ["admin_sos_details", selected?.id],
    queryFn: async () => {
      const { data } = await db.from("sos_request_details").select("*").eq("id", selected!.id);
      const row = Array.isArray(data) ? data[0] : data;
      return row as { driverPhone?: string | null; exactLat?: number | null; exactLng?: number | null } | null;
    },
    enabled: !!selected,
  });

  return (
    <div className="p-4 pt-6 space-y-4 max-w-2xl mx-auto">
      <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {"Back"}
      </button>

      <div>
        <h1 className="text-2xl font-bold">{"SOS Requests"}</h1>
        <p className="text-sm text-muted-foreground">{"All Car SOS requests from Driver Saathi."}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : statusLabel(f)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">{"No SOS requests yet."}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Card key={r.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setSelected(r)}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Siren className="h-4 w-4" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{r.category ?? "—"} • {r.areaText ?? "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {"Driver"}: {r.driverId ? `${r.driverId.slice(0, 8)}…` : "—"}
                        {" • "}{r.mechanicName ?? "Unassigned"}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold">{statusLabel(r.status)}</p>
                    {r.created_at && (
                      <p className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
                    )}
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
            <DialogTitle>{"SOS Details"}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">{"Category"}: </span>{selected.category ?? "—"}</p>
              <p><span className="text-muted-foreground">{"Description"}: </span>{selected.description ?? "—"}</p>
              <p><span className="text-muted-foreground">{"Driver"}: </span><span className="break-all">{selected.driverId ?? "—"}</span></p>
              <p><span className="text-muted-foreground">{"Mechanic"}: </span>{selected.mechanicName ?? "Unassigned"}</p>
              {selected.mechanicPhone && (
                <p><span className="text-muted-foreground">{"Mechanic phone"}: </span><a href={`tel:${selected.mechanicPhone}`} className="text-primary">{selected.mechanicPhone}</a></p>
              )}
              <p><span className="text-muted-foreground">{"Approx location"}: </span>{selected.approxLat !== null && selected.approxLat !== undefined ? `${selected.approxLat}, ${selected.approxLng}` : "—"}</p>
              {details?.driverPhone && (
                <p><span className="text-muted-foreground">{"Driver phone (admin only)"}: </span><a href={`tel:${details.driverPhone}`} className="text-primary">{details.driverPhone}</a></p>
              )}
              {details?.exactLat !== null && details?.exactLat !== undefined && (
                <p><span className="text-muted-foreground">{"Exact location (admin only)"}: </span><a href={`https://maps.google.com/maps?q=${details.exactLat},${details.exactLng}`} target="_blank" rel="noreferrer" className="text-primary">{details.exactLat}, {details.exactLng}</a></p>
              )}
              <p><span className="text-muted-foreground">{"Charges agreed"}: </span>{selected.chargesAgreed !== null && selected.chargesAgreed !== undefined ? `₹${selected.chargesAgreed}` : "—"}</p>
              <p><span className="text-muted-foreground">{"Rating"}: </span>{selected.rating ?? "—"}</p>
              <p><span className="text-muted-foreground">{"Date"}: </span>{selected.created_at ? new Date(selected.created_at).toLocaleString() : "—"}</p>
              <Button variant="outline" className="w-full" onClick={() => setSelected(null)}>{"Cancel"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
