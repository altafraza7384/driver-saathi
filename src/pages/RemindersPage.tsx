import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Bell, Check, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = ["insurance", "puc", "license", "emi", "maintenance", "general"];

export default function RemindersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", reminder_date: "", category: "general", notify_date: "", notify_time: "" });

  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reminders").select("*").order("reminder_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const notifyAt = form.notify_date && form.notify_time ? `${form.notify_date}T${form.notify_time}:00` : form.notify_date ? `${form.notify_date}T09:00:00` : null;
      const { error } = await supabase.from("reminders").insert({
        user_id: user!.id, title: form.title, description: form.description || null,
        reminder_date: form.reminder_date, category: form.category,
        notify_at: notifyAt,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
      setOpen(false);
      setForm({ title: "", description: "", reminder_date: "", category: "general", notify_date: "", notify_time: "" });
      toast.success("Reminder added!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase.from("reminders").update({ is_completed: completed }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reminders"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reminders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reminders"] }),
  });

  const pending = reminders.filter((r) => !r.is_completed);
  const completed = reminders.filter((r) => r.is_completed);

  return (
    <div className="space-y-5 p-4 pt-6">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reminders</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Reminder</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Insurance renewal" /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date</Label><Input type="date" value={form.reminder_date} onChange={(e) => setForm({ ...form, reminder_date: e.target.value })} /></div>
                <div>
                  <Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Notify Date</Label><Input type="date" value={form.notify_date} onChange={(e) => setForm({ ...form, notify_date: e.target.value })} /></div>
                <div><Label>Notify Time</Label><Input type="time" value={form.notify_time} onChange={(e) => setForm({ ...form, notify_time: e.target.value })} /></div>
              </div>
              <Button className="w-full" onClick={() => addMutation.mutate()} disabled={!form.title || !form.reminder_date || addMutation.isPending}>
                {addMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : (
        <>
          {pending.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Pending ({pending.length})</h2>
              <div className="space-y-2">
                {pending.map((r) => (
                  <Card key={r.id} className="border-warning/20">
                    <CardContent className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => toggleMutation.mutate({ id: r.id, completed: true })} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-warning text-warning hover:bg-warning/10"><Bell className="h-4 w-4" /></button>
                        <div>
                          <p className="text-sm font-medium">{r.title}</p>
                          <p className="text-xs text-muted-foreground">{r.reminder_date} • <span className="capitalize">{r.category}</span></p>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(r.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Completed ({completed.length})</h2>
              <div className="space-y-2">
                {completed.map((r) => (
                  <Card key={r.id} className="opacity-60">
                    <CardContent className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => toggleMutation.mutate({ id: r.id, completed: false })} className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success"><Check className="h-4 w-4" /></button>
                        <div>
                          <p className="text-sm font-medium line-through">{r.title}</p>
                          <p className="text-xs text-muted-foreground">{r.reminder_date}</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(r.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
          {reminders.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">No reminders yet.</CardContent></Card>}
        </>
      )}
    </div>
  );
}
