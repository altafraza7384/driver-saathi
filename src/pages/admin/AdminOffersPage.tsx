import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { ArrowLeft, Plus, Pencil, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type Offer = {
  id: string;
  title: string;
  description: string;
  discount_percent: number;
  plan_id: string | null;
  valid_until: string | null;
  is_active: boolean;
  sort_order: number;
};

const emptyForm = {
  title: "", description: "", discount_percent: "0",
  plan_id: "all", valid_until: "", sort_order: "0",
};

export default function AdminOffersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Offer | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: offers = [], isLoading } = useQuery({
    queryKey: ["admin_offers"],
    queryFn: async () => {
      const { data, error } = await db.from("offers").select("*").order("sort_order");
      if (error) throw error;
      return data as Offer[];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["admin_offers_plans"],
    queryFn: async () => {
      const { data, error } = await db.from("subscription_plans").select("id, name").order("sort_order");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin_offers"] });
    qc.invalidateQueries({ queryKey: ["offers"] });
  };

  const discount = Number(form.discount_percent);
  const valid = form.title.trim().length > 0
    && Number.isFinite(discount) && discount >= 0 && discount <= 100;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        discount_percent: discount,
        plan_id: form.plan_id === "all" ? null : form.plan_id,
        valid_until: form.valid_until || null,
        sort_order: Number(form.sort_order) || 0,
      };
      const { error } = edit
        ? await db.from("offers").update(payload).eq("id", edit.id)
        : await db.from("offers").insert({ ...payload, is_active: true });
      if (error) throw error;
    },
    onSuccess: () => { refresh(); toast.success(edit ? "Offer updated" : "Offer created"); close(); },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await db.from("offers").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("offers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { refresh(); toast.success("Offer deleted"); },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const close = () => { setOpen(false); setEdit(null); setForm(emptyForm); };
  const openNew = () => { setEdit(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (o: Offer) => {
    setEdit(o);
    setForm({
      title: o.title, description: o.description ?? "",
      discount_percent: String(o.discount_percent ?? 0),
      plan_id: o.plan_id ?? "all",
      valid_until: o.valid_until ?? "",
      sort_order: String(o.sort_order ?? 0),
    });
    setOpen(true);
  };

  const planName = (planId: string | null) =>
    planId ? (plans.find((p) => p.id === planId)?.name ?? planId) : "All plans";

  return (
    <div className="p-4 pt-6 space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> {"Back"}
        </button>
        <Button size="sm" className="gap-1" onClick={openNew}><Plus className="h-4 w-4" /> {"Add Offer"}</Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{"Offers"}</h1>
        <p className="text-sm text-muted-foreground">{"Discount offers shown on the subscription plans card."}</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : offers.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">{"No offers yet."}</p>
      ) : (
        <div className="space-y-2">
          {offers.map((o) => (
            <Card key={o.id}>
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Tag className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{o.title} — {o.discount_percent}%</p>
                    <p className="text-xs text-muted-foreground">
                      {planName(o.plan_id)}
                      {o.valid_until ? ` • ${"Valid until"}: ${o.valid_until}` : ""} • {o.is_active ? "Active" : "Inactive"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Switch aria-label="Active" checked={o.is_active} onCheckedChange={(v) => toggle.mutate({ id: o.id, is_active: v })} />
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Edit offer" onClick={() => openEdit(o)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                  <Button
                    variant="ghost" size="icon" className="h-9 w-9" aria-label="Delete offer"
                    onClick={() => { if (window.confirm("Delete this offer?")) remove.mutate(o.id); }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{edit ? "Edit Offer" : "Add Offer"}</DialogTitle>
            <DialogDescription>{"Discount offers shown on the subscription plans card."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="offer-title">{"Title"}</Label><Input id="offer-title" maxLength={80} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label htmlFor="offer-desc">{"Description"}</Label><Textarea id="offer-desc" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div><Label htmlFor="offer-discount">{"Discount (%)"}</Label><Input id="offer-discount" inputMode="numeric" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} /></div>
            <div>
              <Label>{"Plan"}</Label>
              <Select value={form.plan_id} onValueChange={(v) => setForm({ ...form, plan_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{"All plans"}</SelectItem>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{"Valid until"}</Label>
              <DatePicker
                value={form.valid_until}
                onChange={(v) => setForm({ ...form, valid_until: v })}
                placeholder={"Valid until"}
              />
            </div>
            <div><Label htmlFor="offer-sort">{"Order"}</Label><Input id="offer-sort" inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
            <Button className="w-full" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
