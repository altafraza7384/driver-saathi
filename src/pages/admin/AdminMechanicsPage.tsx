import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Wrench, Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

type Mechanic = {
  id: string;
  name?: string | null;
  shopName?: string | null;
  categories?: string[] | null;
  isOnline?: boolean | null;
  status?: string | null;
  warnings?: number | null;
  warning_history?: { reason: string; at: string; by: string }[] | null;
  held_at?: string | null;
  held_reason?: string | null;
};

type SosRequest = {
  id: string;
  mechanicId?: string | null;
  status?: string | null;
  rating?: number | null;
};

const DEFAULT_STRIKE_LIMIT = 3;

export default function AdminMechanicsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Mechanic | null>(null);
  const [limitInput, setLimitInput] = useState("");

  const { data: mechanics = [], isLoading } = useQuery({
    queryKey: ["admin_mechanics"],
    queryFn: async () => {
      const { data, error } = await db.from("mechanics").select("*");
      if (error) throw error;
      return data as Mechanic[];
    },
  });

  const { data: requests = [] } = useQuery({
    queryKey: ["admin_mechanics_sos"],
    queryFn: async () => {
      const { data, error } = await db.from("sos_requests").select("*");
      if (error) throw error;
      return data as SosRequest[];
    },
  });

  const { data: configDoc } = useQuery({
    queryKey: ["admin_config"],
    queryFn: async () => {
      const { data, error } = await db.from("config").select("*").eq("id", "admin");
      if (error) throw error;
      const rows = data as { id: string; mechanic_strike_limit: number }[];
      return rows[0] ?? null;
    },
  });

  const strikeLimit = configDoc?.mechanic_strike_limit ?? DEFAULT_STRIKE_LIMIT;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin_mechanics"] });
    qc.invalidateQueries({ queryKey: ["admin_config"] });
  };

  const updateMechanic = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await db.from("mechanics").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const saveLimit = useMutation({
    mutationFn: async (limit: number) => {
      if (configDoc) {
        const { error } = await db.from("config").update({ mechanic_strike_limit: limit }).eq("id", "admin");
        if (error) throw error;
      } else {
        const { error } = await db.from("config").insert({ id: "admin", mechanic_strike_limit: limit });
        if (error) throw error;
      }
    },
    onSuccess: () => { refresh(); toast.success("Strike limit saved"); },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const statsFor = (m: Mechanic) => {
    const mine = requests.filter((r) => r.mechanicId === m.id);
    const done = mine.filter((r) => r.status === "completed");
    const cancels = mine.filter((r) => r.status === "cancelled").length;
    const handled = mine.filter((r) => r.status !== "pending");
    const positive = mine.filter((r) => ["accepted", "onway", "completed"].includes(r.status ?? "")).length;
    const rated = done.filter((r) => typeof r.rating === "number");
    return {
      jobs: done.length,
      cancels,
      acceptRate: handled.length === 0 ? null : Math.round((positive / handled.length) * 100),
      avgRating: rated.length === 0 ? null : rated.reduce((a, r) => a + (r.rating as number), 0) / rated.length,
    };
  };

  const warn = (m: Mechanic) => {
    const reason = window.prompt("Reason for this warning…");
    if (reason === null || reason.trim() === "") return;
    const warnings = (m.warnings ?? 0) + 1;
    const patch: Record<string, unknown> = {
      warnings,
      warning_history: [...(m.warning_history ?? []), { reason: reason.trim(), at: new Date().toISOString(), by: user?.id ?? "" }],
    };
    const held = warnings >= strikeLimit;
    if (held) {
      patch.status = "held";
      patch.held_at = new Date().toISOString();
      patch.held_reason = reason.trim();
    }
    updateMechanic.mutate(
      { id: m.id, patch },
      {
        onSuccess: () => {
          toast.success(held ? "Mechanic warned and held (strike limit reached)" : "Mechanic warned");
          setSelected((s) => (s && s.id === m.id ? { ...s, ...patch } as Mechanic : s));
        },
      },
    );
  };

  const hold = (m: Mechanic) => {
    const reason = window.prompt("Reason for holding this mechanic…");
    if (reason === null || reason.trim() === "") return;
    const patch = { status: "held", held_at: new Date().toISOString(), held_reason: reason.trim() };
    updateMechanic.mutate(
      { id: m.id, patch },
      {
        onSuccess: () => {
          toast.success("Mechanic account held");
          setSelected((s) => (s && s.id === m.id ? { ...s, ...patch } : s));
        },
      },
    );
  };

  const unhold = (m: Mechanic) => {
    const patch = { status: "active", held_at: null, held_reason: null };
    updateMechanic.mutate(
      { id: m.id, patch },
      {
        onSuccess: () => {
          toast.success("Mechanic account unheld");
          setSelected((s) => (s && s.id === m.id ? { ...s, ...patch } : s));
        },
      },
    );
  };

  const resetWarnings = (m: Mechanic) => {
    updateMechanic.mutate(
      { id: m.id, patch: { warnings: 0 } },
      {
        onSuccess: () => {
          toast.success("Warnings reset");
          setSelected((s) => (s && s.id === m.id ? { ...s, warnings: 0 } : s));
        },
      },
    );
  };

  return (
    <div className="p-4 pt-6 space-y-5 max-w-2xl mx-auto">
      <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {"Back"}
      </button>

      <div>
        <h1 className="text-2xl font-bold">{"Mechanics"}</h1>
        <p className="text-sm text-muted-foreground">{"Manage Mechanic Saathi mechanics, warnings and holds."}</p>
      </div>

      <Card>
        <CardContent className="p-3 space-y-2">
          <Label htmlFor="strike-limit">{"Strike limit"}</Label>
          <p className="text-xs text-muted-foreground">{"A mechanic is auto-held after this many warnings. Set between 1 and 10."}</p>
          <div className="flex gap-2">
            <Input
              id="strike-limit"
              inputMode="numeric"
              placeholder={String(strikeLimit)}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
            />
            <Button
              size="sm"
              disabled={saveLimit.isPending || !limitInput || Number(limitInput) < 1 || Number(limitInput) > 10}
              onClick={() => { saveLimit.mutate(Number(limitInput)); setLimitInput(""); }}
            >
              {"Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : mechanics.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">{"No mechanics yet."}</p>
      ) : (
        <div className="space-y-2">
          {mechanics.map((m) => {
            const s = statsFor(m);
            const held = m.status === "held";
            return (
              <Card key={m.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setSelected(m)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wrench className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{m.name || "—"}{m.shopName ? ` • ${m.shopName}` : ""}</p>
                        <p className="text-xs text-muted-foreground">
                          {"Jobs done"}: {s.jobs} • {"Cancels"}: {s.cancels}
                          {s.acceptRate !== null && ` • ${"Accept rate"}: ${s.acceptRate}%`}
                          {s.avgRating !== null && ` • ⭐ ${s.avgRating.toFixed(1)}`}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {held ? (
                        <span className="rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-bold text-destructive">{"Held"}</span>
                      ) : (
                        <span className="rounded-full bg-success/10 px-2 py-1 text-[10px] font-bold text-success">{"Active"}</span>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {m.isOnline ? "Online" : "Offline"} • {"Warnings"}: {m.warnings ?? 0}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.name || "Mechanics"}</DialogTitle>
          </DialogHeader>
          {selected && (() => {
            const s = statsFor(selected);
            return (
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  {selected.shopName && <p className="font-semibold">{selected.shopName}</p>}
                  {selected.categories && selected.categories.length > 0 && (
                    <p className="text-xs text-muted-foreground">{selected.categories.join(" • ")}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {"Status"}: {selected.status === "held" ? "Held" : "Active"}
                    {selected.status === "held" && selected.held_reason ? ` — ${selected.held_reason}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {"Jobs done"}: {s.jobs} • {"Cancels"}: {s.cancels}
                    {s.acceptRate !== null && ` • ${"Accept rate"}: ${s.acceptRate}%`}
                    {s.avgRating !== null && ` • ⭐ ${s.avgRating.toFixed(1)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">{"Warnings"}: {selected.warnings ?? 0} (limit: {strikeLimit})</p>
                  <p className="text-[10px] text-muted-foreground break-all">ID: {selected.id}</p>
                </div>

                {(selected.warning_history ?? []).length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase text-muted-foreground mb-2">{"Warnings"}</p>
                    <div className="space-y-1">
                      {(selected.warning_history ?? []).map((w, i) => (
                        <p key={i} className="rounded-lg border p-2 text-xs">
                          {w.reason}
                          <span className="block text-muted-foreground">{new Date(w.at).toLocaleString()}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => warn(selected)}>{"Warn"}</Button>
                  {selected.status === "held" ? (
                    <Button onClick={() => unhold(selected)}>{"Unhold account"}</Button>
                  ) : (
                    <Button variant="destructive" onClick={() => hold(selected)}>{"Hold account"}</Button>
                  )}
                  <Button variant="outline" className="col-span-2" onClick={() => resetWarnings(selected)}>
                    {"Reset warnings"}
                  </Button>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setSelected(null)}>{"Cancel"}</Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
