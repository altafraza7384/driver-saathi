import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Search, Users as UsersIcon, Mail, Phone, Car, Calendar } from "lucide-react";
import { useNavigate } from "react-router-dom";

type AdminUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  provider: string;
  profile: {
    full_name: string | null;
    phone: string | null;
    vehicle_type: string | null;
    vehicle_number: string | null;
    license_number: string | null;
    preferred_language: string | null;
    avatar_url: string | null;
  } | null;
  counts: Record<string, number>;
};

const COUNT_LABELS: Record<string, string> = {
  transactions: "Transactions",
  notes: "Notes",
  reminders: "Reminders",
  debts: "Debts",
  goals: "Goals",
  health_logs: "Health Logs",
  car_checks: "Car Checks",
  car_documents: "Car Docs",
  emergency_contacts: "Emergency Contacts",
  platform_affiliations: "Platforms",
};

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdminUser | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin_users"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-list-users");
      if (error) throw error;
      return data as { users: AdminUser[] };
    },
  });

  const users = data?.users || [];
  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.profile?.full_name?.toLowerCase().includes(q) ||
      u.profile?.phone?.toLowerCase().includes(q) ||
      u.profile?.vehicle_number?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 pt-6 space-y-4 max-w-2xl mx-auto">
      <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex items-center gap-2">
        <UsersIcon className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">All Users ({users.length})</h1>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by email, name, phone, vehicle…"
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
            Failed to load users: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">No users found</CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((u) => {
          const totalRecords = Object.values(u.counts).reduce((a, b) => a + b, 0);
          return (
            <Card key={u.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setSelected(u)}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{u.profile?.full_name || "Unnamed"}</p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {u.email}
                    </p>
                    {u.profile?.phone && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {u.profile.phone}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold">{totalRecords} records</p>
                    <p className="text-[10px] text-muted-foreground">{u.provider}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.profile?.full_name || "User Details"}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="space-y-1">
                <p className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> {selected.email}</p>
                {selected.profile?.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /> {selected.profile.phone}</p>}
                {selected.profile?.vehicle_number && (
                  <p className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-muted-foreground" />
                    {selected.profile.vehicle_type || "Vehicle"} — {selected.profile.vehicle_number}
                  </p>
                )}
                {selected.profile?.license_number && (
                  <p className="text-xs text-muted-foreground">License: {selected.profile.license_number}</p>
                )}
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" /> Joined {new Date(selected.created_at).toLocaleDateString()}
                </p>
                {selected.last_sign_in_at && (
                  <p className="text-xs text-muted-foreground">
                    Last login: {new Date(selected.last_sign_in_at).toLocaleString()}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Auth provider: {selected.provider}</p>
                <p className="text-[10px] text-muted-foreground break-all">ID: {selected.id}</p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase text-muted-foreground mb-2">Saved Data</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(COUNT_LABELS).map(([key, label]) => (
                    <div key={key} className="rounded-lg border p-2">
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                      <p className="text-lg font-bold">{selected.counts[key] || 0}</p>
                    </div>
                  ))}
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={() => setSelected(null)}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
