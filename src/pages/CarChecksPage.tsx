import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { formatINR } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Car, Wrench, Fuel, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

const CHECK_TYPES = ["Oil Change", "Tire Rotation", "Brake Check", "Battery", "Air Filter", "Coolant", "PUC", "Insurance", "Fitness Certificate", "General Service"];

export default function CarChecksPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ check_type: "", description: "", odometer_reading: "", cost: "", check_date: new Date().toISOString().split("T")[0], next_due_date: "" });

  const { data: checks = [], isLoading } = useQuery({
    queryKey: ["car_checks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("car_checks").select("*").order("check_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("car_checks").insert({
        user_id: user!.id,
        check_type: form.check_type,
        description: form.description || null,
        odometer_reading: form.odometer_reading ? Number(form.odometer_reading) : null,
        cost: form.cost ? Number(form.cost) : 0,
        check_date: form.check_date,
        next_due_date: form.next_due_date || null,
        is_completed: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["car_checks"] });
      setOpen(false);
      setForm({ check_type: "", description: "", odometer_reading: "", cost: "", check_date: new Date().toISOString().split("T")[0], next_due_date: "" });
      toast.success("Car check added!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("car_checks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["car_checks"] }),
  });

  return (
    <div className="space-y-5 p-4 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Car Checks</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Car Check</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Type</Label>
                <Select value={form.check_type} onValueChange={(v) => setForm({ ...form, check_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>{CHECK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Odometer</Label><Input type="number" value={form.odometer_reading} onChange={(e) => setForm({ ...form, odometer_reading: e.target.value })} /></div>
                <div><Label>Cost (₹)</Label><Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={form.check_date} onChange={(e) => setForm({ ...form, check_date: e.target.value })} /></div>
                <div><Label>Next Due</Label><Input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} /></div>
              </div>
              <Button className="w-full" onClick={() => addMutation.mutate()} disabled={!form.check_type || addMutation.isPending}>
                {addMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : checks.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No car checks yet. Add your first maintenance record!</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {checks.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10 text-warning">
                    <Wrench className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{c.check_type}</p>
                    <p className="text-xs text-muted-foreground">{c.check_date}{c.cost ? ` • ${formatINR(c.cost)}` : ""}</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
