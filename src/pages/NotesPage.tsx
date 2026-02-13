import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, StickyNote, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

export default function NotesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ title: "", content: "", tags: "" });

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["notes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("notes").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const tags = form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      const { error } = await supabase.from("notes").insert({
        user_id: user!.id, title: form.title, content: form.content, tags,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setOpen(false);
      setForm({ title: "", content: "", tags: "" });
      toast.success("Note saved!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });

  const filtered = notes.filter((n) =>
    n.title.toLowerCase().includes(search.toLowerCase()) ||
    n.content.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5 p-4 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notes</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Note</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Note title" /></div>
              <div><Label>Content</Label><Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} placeholder="Write your note..." /></div>
              <div><Label>Tags (comma separated)</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="fuel, personal" /></div>
              <Button className="w-full" onClick={() => addMutation.mutate()} disabled={!form.title || addMutation.isPending}>
                {addMutation.isPending ? "Saving..." : "Save Note"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search notes..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">{search ? "No matching notes." : "No notes yet."}</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => (
            <Card key={n.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <StickyNote className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold">{n.title}</p>
                    </div>
                    {n.content && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.content}</p>}
                    {n.tags && n.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {n.tags.map((tag: string) => <span key={tag} className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">{tag}</span>)}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(n.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
