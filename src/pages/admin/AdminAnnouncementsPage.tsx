import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Megaphone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

// Admin-only announcements (English only, like all admin pages).
// An announcement created here does TWO things:
//  1. In-app, immediately after the next Lovable publish: Home banner +
//     once-per-announcement popup (see AnnouncementBanner). This works
//     WITHOUT Blaze and WITHOUT a new APK.
//  2. Closed-app native push (FCM): the staged function
//     `sendAnnouncementPush` in firebase/functions/src/index.ts fires on
//     announcement creation and sends to stored FCM tokens, filtered by
//     audience. That function is NOT deployed yet — Cloud Functions cannot
//     deploy on Spark, so it deploys only after Blaze. Until then, step 1
//     is the live path and step 2 is code-ready only. Never put an FCM
//     server key in this page or any client code to work around that.
type Announcement = {
  id: string;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  audience?: string | null;
  is_active?: boolean | null;
  expires_at?: string | null;
  created_at?: string | null;
};

const EMPTY = { title: "", message: "", type: "news", audience: "all", is_active: true, expires_at: "" };

export default function AdminAnnouncementsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState(EMPTY);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["admin_announcements"],
    queryFn: async () => {
      const { data, error } = await db.from("announcements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Announcement[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin_announcements"] });
    queryClient.invalidateQueries({ queryKey: ["announcements"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.message.trim()) throw new Error("Title and message are required.");
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        type: form.type,
        audience: form.audience,
        is_active: form.is_active,
        expires_at: form.expires_at || null,
      } as never;
      if (editing) {
        const { error } = await db.from("announcements").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("announcements").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY);
      toast.success("Announcement saved!");
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (a: Announcement) => {
      const { error } = await db.from("announcements").update({ is_active: !a.is_active } as never).eq("id", a.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Announcement deleted.");
    },
    onError: (e: Error) => toast.error(friendlyErrorMessage(e)),
  });

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setForm({
      title: a.title ?? "",
      message: a.message ?? "",
      type: a.type ?? "news",
      audience: a.audience ?? "all",
      is_active: a.is_active ?? true,
      expires_at: a.expires_at ?? "",
    });
    setDialogOpen(true);
  };

  return (
    <div className="p-4 pt-6 space-y-4 max-w-2xl mx-auto">
      <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {"Back"}
      </button>

      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{"Announcements"}</h1>
          <p className="text-sm text-muted-foreground">
            {"Custom news and subscription offers. Shows as a Home banner + popup in-app immediately. Closed-app push (FCM) is staged in Functions and deploys after Blaze — it does not send yet."}
          </p>
        </div>
        <Button onClick={openNew}>{"New"}</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : announcements.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">{"No announcements yet."}</p>
      ) : (
        <div className="space-y-2">
          {announcements.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Megaphone className="h-4 w-4" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{a.title ?? "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {a.type === "offer" ? "Offer" : "News"} • {a.audience === "non_subscribers" ? "Non-subscribers only" : "All users"}
                        {a.expires_at ? ` • Expires ${a.expires_at}` : ""}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold">{a.is_active ? "Active" : "Inactive"}</span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{a.message ?? ""}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(a)}>{"Edit"}</Button>
                  <Button size="sm" variant="outline" onClick={() => toggleMutation.mutate(a)} disabled={toggleMutation.isPending}>
                    {a.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(a.id)} disabled={deleteMutation.isPending}>
                    {"Delete"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Announcement" : "New Announcement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ann-title">{"Title"}</Label>
              <Input id="ann-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. New subscription offer" />
            </div>
            <div>
              <Label htmlFor="ann-message">{"Message"}</Label>
              <Textarea id="ann-message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Write the news or offer in the users' language." rows={4} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ann-type">{"Type"}</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger id="ann-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="news">{"News"}</SelectItem>
                    <SelectItem value="offer">{"Subscription Offer"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ann-audience">{"Audience"}</Label>
                <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v })}>
                  <SelectTrigger id="ann-audience"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{"All users"}</SelectItem>
                    <SelectItem value="non_subscribers">{"Non-subscribers only"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="ann-expiry">{"Expiry (optional)"}</Label>
              <DatePicker id="ann-expiry" label="Expiry (optional)" value={form.expires_at} onChange={(value) => setForm({ ...form, expires_at: value })} placeholder="No expiry" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v === true })} />
              {"Active (shows to users)"}
            </label>
            <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setDialogOpen(false)}>{"Cancel"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
