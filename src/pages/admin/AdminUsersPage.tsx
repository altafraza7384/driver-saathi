import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/backend";
import { firebaseDb } from "@/integrations/firebase/client";
import { friendlyErrorMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Search, Users as UsersIcon, Mail, Phone, Car, Calendar, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

type AdminUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  vehicle_type: string | null;
  vehicle_number: string | null;
  license_number: string | null;
  preferred_language: string | null;
  is_blocked: boolean;
  subscription_plan_id: string | null;
  created_at: string | null;
};

type Plan = { id: string; name: string };

// Per-user subcollections under users/{uid}. Counted on demand when the
// detail dialog opens: the adapter's per-user queries always scope to the
// signed-in user, so they cannot count another user's data — plain
// firestore reads are used instead (rules allow admin reads).
const COUNT_COLLECTIONS = [
  "transactions", "debts", "goals", "reminders", "car_checks",
  "car_documents", "notes", "health_logs", "emergency_contacts", "platform_affiliations",
] as const;

// Admin pages are English-only by rule, so these are plain English labels,
// not i18n keys. (A previous version rendered them through t(), which was
// never defined in this file, so the page crashed to a white screen.)
const COUNT_KEYS: Record<(typeof COUNT_COLLECTIONS)[number], string> = {
  transactions: "Transactions",
  debts: "Debts",
  goals: "Goals",
  reminders: "Reminders",
  car_checks: "Car Checks",
  car_documents: "Car Documents",
  notes: "Notes",
  health_logs: "Health Logs",
  emergency_contacts: "Emergency Contacts",
  platform_affiliations: "Platforms",
};

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [planChoice, setPlanChoice] = useState<string>("none");

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ["admin_users"],
    queryFn: async () => {
      const { data, error } = await db.from("users").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as AdminUser[];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["admin_users_plans"],
    queryFn: async () => {
      const { data, error } = await db.from("subscription_plans").select("id, name").order("sort_order");
      if (error) throw error;
      return data as Plan[];
    },
  });

  const { data: counts, isLoading: countsLoading } = useQuery({
    queryKey: ["admin_user_counts", selected?.id],
    queryFn: async () => {
      // Parallel (was sequential) and honest about failures: a denied
      // read used to render as "0", indistinguishable from an empty
      // account (audit 2026-10-24). -1 renders as "—".
      const entries = await Promise.all(
        COUNT_COLLECTIONS.map(async (sub) => {
          try {
            const snap = await getDocs(collection(firebaseDb, "users", selected!.id, sub));
            return [sub, snap.size] as const;
          } catch {
            return [sub, -1] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: !!selected,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin_users"] });
  };

  const blockMutation = useMutation({
    mutationFn: async ({ id, blocked }: { id: string; blocked: boolean }) => {
      const { error } = await db.from("users").update({ is_blocked: blocked }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      refresh();
      setSelected((s) => (s ? { ...s, is_blocked: v.blocked } : s));
      toast.success(v.blocked ? "User blocked" : "User unblocked");
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const planMutation = useMutation({
    mutationFn: async ({ id, planId }: { id: string; planId: string | null }) => {
      const { error } = await db.from("users").update({ subscription_plan_id: planId }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      refresh();
      setSelected((s) => (s ? { ...s, subscription_plan_id: v.planId } : s));
      toast.success("Plan assigned");
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const openUser = (u: AdminUser) => {
    setSelected(u);
    setPlanChoice(u.subscription_plan_id ?? "none");
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.full_name ?? "").toLowerCase().includes(q) ||
      (u.phone ?? "").toLowerCase().includes(q) ||
      (u.vehicle_number ?? "").toLowerCase().includes(q)
    );
  });

  const selectedPlan = plans.find((p) => p.id === selected?.subscription_plan_id);
  const isSelf = !!user && selected?.id === user.id;

  return (
    <div className="p-4 pt-6 space-y-4 max-w-2xl mx-auto">
      <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {"Back"}
      </button>

      <div className="flex items-center gap-2">
        <UsersIcon className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{"Users"} ({users.length})</h1>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={"Search by name, email, phone, vehicle…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && (
        <div className="flex justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">
            {friendlyErrorMessage(error as Error)}
          </CardContent>
        </Card>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">{"No users found"}</CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((u) => (
          <Card key={u.id} className="cursor-pointer hover:bg-accent/40" onClick={() => openUser(u)}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{u.full_name || "—"}</p>
                  {u.email && (
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {u.email}
                    </p>
                  )}
                  {u.phone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {u.phone}
                    </p>
                  )}
                </div>
                {u.is_blocked && (
                  <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-bold text-destructive">
                    {"Blocked"}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.full_name || "User Details"}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="space-y-1">
                {selected.is_blocked && (
                  <p className="flex items-center gap-2 font-semibold text-destructive">
                    <ShieldAlert className="h-4 w-4" /> {"Blocked"}
                  </p>
                )}
                {selected.email && <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {selected.email}</p>}
                {selected.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {selected.phone}</p>}
                {selected.vehicle_number && (
                  <p className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-muted-foreground" />
                    {selected.vehicle_type || "—"} — {selected.vehicle_number}
                  </p>
                )}
                {selected.license_number && (
                  <p className="text-xs text-muted-foreground">{selected.license_number}</p>
                )}
                {selected.created_at && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" /> {new Date(selected.created_at).toLocaleDateString()}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground break-all">ID: {selected.id}</p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground mb-2">{"Saved Data"}</p>
                {countsLoading ? (
                  <div className="flex justify-center py-4">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {COUNT_COLLECTIONS.map((key) => (
                      <div key={key} className="rounded-lg border p-2">
                        <p className="text-[10px] text-muted-foreground">{COUNT_KEYS[key]}</p>
                        <p className="text-lg font-bold">{counts?.[key] === -1 ? "—" : (counts?.[key] ?? 0)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-bold uppercase text-muted-foreground">
                  {"Plan"}: {selectedPlan ? selectedPlan.name : "No plan"}
                </p>
                <div className="flex gap-2">
                  <Select value={planChoice} onValueChange={setPlanChoice}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={"Assign plan"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{"No plan"}</SelectItem>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    disabled={planMutation.isPending || planChoice === (selected.subscription_plan_id ?? "none")}
                    onClick={() => planMutation.mutate({ id: selected.id, planId: planChoice === "none" ? null : planChoice })}
                  >
                    {"Save"}
                  </Button>
                </div>
              </div>

              <Button
                variant={selected.is_blocked ? "default" : "destructive"}
                className="w-full"
                disabled={blockMutation.isPending || isSelf}
                onClick={() => blockMutation.mutate({ id: selected.id, blocked: !selected.is_blocked })}
              >
                {selected.is_blocked ? "Unblock user" : "Block user"}
              </Button>
              {isSelf && (
                <p className="text-center text-xs text-muted-foreground">{"You cannot block your own account. Unblocking your own account requires a console edit."}</p>
              )}

              <Button variant="outline" className="w-full" onClick={() => setSelected(null)}>{"Cancel"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
