import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Pencil, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { formatINR } from "@/lib/currency";

type Interval = "free" | "monthly" | "yearly";
type Plan = {
  id: string; name: string; description: string; price_inr: number; billing_interval: string;
  features: string[]; is_active: boolean; sort_order: number;
};
const emptyForm = { name: "", description: "", price_inr: "0", billing_interval: "free" as Interval, features: "", sort_order: "0" };

export default function AdminPlansPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Plan | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["admin_subscription_plans"],
    queryFn: async () => {
      const { data, error } = await db.from("subscription_plans").select("*").order("sort_order");
      if (error) throw error;
      return data as Plan[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin_subscription_plans"] });
    qc.invalidateQueries({ queryKey: ["subscription_plans"] });
  };

  const price = Number(form.price_inr);
  const priceValid = Number.isFinite(price) && price >= 0 && (form.billing_interval === "free" ? price === 0 : price > 0);
  const valid = form.name.trim().length > 0 && form.description.trim().length > 0 && priceValid;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        price_inr: form.billing_interval === "free" ? 0 : price,
        billing_interval: form.billing_interval,
        features: form.features.split("\n").map((f) => f.trim()).filter(Boolean),
        sort_order: Number(form.sort_order) || 0,
      };
      const { error } = edit
        ? await db.from("subscription_plans").update(payload).eq("id", edit.id)
        : await db.from("subscription_plans").insert({ ...payload, is_active: true });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); toast.success(edit ? "Plan updated" : "Plan created"); close(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await db.from("subscription_plans").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const close = () => { setOpen(false); setEdit(null); setForm(emptyForm); };
  const openNew = () => { setEdit(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (p: Plan) => {
    setEdit(p);
    setForm({
      name: p.name, description: p.description, price_inr: String(p.price_inr),
      billing_interval: (p.billing_interval as Interval) ?? "free",
      features: (p.features ?? []).join("\n"), sort_order: String(p.sort_order),
    });
    setOpen(true);
  };

  return (
    <div className="p-4 pt-6 space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <Button size="sm" className="gap-1" onClick={openNew}><Plus className="h-4 w-4" /> Add Plan</Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Subscription Plans</h1>
        <p className="text-sm text-muted-foreground">Payments are not active yet. Drivers can only view active plans.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : plans.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">No plans yet.</p>
      ) : (
        <div className="space-y-2">
          {plans.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><CreditCard className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {Number(p.price_inr) === 0 ? "Free" : `${formatINR(Number(p.price_inr))} / ${p.billing_interval === "yearly" ? "year" : "month"}`} • Order {p.sort_order} • {p.is_active ? "Active" : "Hidden"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch aria-label="Active" checked={p.is_active} onCheckedChange={(v) => toggle.mutate({ id: p.id, is_active: v })} />
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Edit plan" onClick={() => openEdit(p)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit ? "Edit Plan" : "Add Plan"}</DialogTitle>
            <DialogDescription>Saving a plan does not charge anyone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="plan-name">Name</Label><Input id="plan-name" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label htmlFor="plan-desc">Description</Label><Textarea id="plan-desc" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Billing</Label>
                <Select value={form.billing_interval} onValueChange={(v) => setForm({ ...form, billing_interval: v as Interval, price_inr: v === "free" ? "0" : form.price_inr })}>
                  <SelectTrigger aria-label="Billing"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="plan-price">Price (₹)</Label><Input id="plan-price" type="number" inputMode="decimal" min={0} disabled={form.billing_interval === "free"} value={form.price_inr} onChange={(e) => setForm({ ...form, price_inr: e.target.value })} /></div>
            </div>
            {!priceValid && <p className="text-xs text-destructive">Free plans must be ₹0; paid plans need a price above ₹0.</p>}
            <div><Label htmlFor="plan-features">Features (one per line)</Label><Textarea id="plan-features" rows={4} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} /></div>
            <div><Label htmlFor="plan-order">Sort Order</Label><Input id="plan-order" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
            <Button className="w-full" onClick={() => save.mutate()} disabled={!valid || save.isPending}>
              {save.isPending ? "Saving..." : edit ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
