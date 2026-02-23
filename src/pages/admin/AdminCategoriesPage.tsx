import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, ArrowLeft, Pencil, Store } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";

export default function AdminCategoriesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editCat, setEditCat] = useState<any>(null);
  const [form, setForm] = useState({ name: "", icon: "Store", sort_order: "0" });

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["admin_all_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_categories").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, icon: form.icon, sort_order: Number(form.sort_order) };
      if (editCat) {
        const { error } = await supabase.from("marketplace_categories").update(payload as any).eq("id", editCat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("marketplace_categories").insert({ ...payload, is_active: true } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_all_categories"] });
      resetForm();
      toast.success(editCat ? "Category updated!" : "Category created!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("marketplace_categories").update({ is_active } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin_all_categories"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("marketplace_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_all_categories"] });
      toast.success("Category deleted");
    },
  });

  const resetForm = () => {
    setOpen(false);
    setEditCat(null);
    setForm({ name: "", icon: "Store", sort_order: "0" });
  };

  const openEdit = (cat: any) => {
    setEditCat(cat);
    setForm({ name: cat.name, icon: cat.icon, sort_order: String(cat.sort_order) });
    setOpen(true);
  };

  const ICON_OPTIONS = ["Shield", "UserCheck", "FileCheck", "Wrench", "Cog", "GraduationCap", "Store"];

  return (
    <div className="p-4 pt-6 space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); else setOpen(true); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add Category</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editCat ? "Edit Category" : "Add Category"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Vehicle Garages" /></div>
              <div>
                <Label>Icon</Label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {ICON_OPTIONS.map((icon) => (
                    <button
                      key={icon}
                      onClick={() => setForm({ ...form, icon })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-all ${form.icon === icon ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"}`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              <div><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
              <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : editCat ? "Update" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <h1 className="text-2xl font-bold">Categories</h1>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : (
        <div className="space-y-2">
          {(categories as any[]).map((cat) => (
            <Card key={cat.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Store className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{cat.name}</p>
                    <p className="text-xs text-muted-foreground">Order: {cat.sort_order} • Icon: {cat.icon}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={cat.is_active} onCheckedChange={(v) => toggleMutation.mutate({ id: cat.id, is_active: v })} />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(cat)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteMutation.mutate(cat.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
