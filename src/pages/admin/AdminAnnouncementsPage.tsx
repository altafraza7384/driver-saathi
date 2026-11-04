import { useState, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { friendlyErrorMessage } from "@/lib/errorMessages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Megaphone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { firebaseStorage } from "@/integrations/firebase/client";
import { ref, uploadBytes, getDownloadURL, deleteObject, refFromURL } from "firebase/storage";

/**
 * Admin-only announcements (English only, hardcoded here, no language keys).
 *
 * Admins create/edit/disable announcements stored in the shared announcements
 * collection. These are read by Home's AnnouncementBanner (banner + popup) and
 * by the announcements section in More. Changing the shape here (extra fields,
 * extra type/audience values) changes what every user sees, so keep this file
 * intentionally boring: exactly the fields the reader expects, nothing else.
 */

interface Announcement {
  id: string;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  audience?: string | null;
  is_active?: boolean | null;
  expires_at?: string | null;
  image_url?: string | null;
  created_at?: string | null;
}

const EMPTY = { title: "", message: "", type: "news", audience: "all", is_active: true, expires_at: "" };

export default function AdminAnnouncementsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState("");
  const [removeImage, setRemoveImage] = useState(false);

  const { data: announcements = [] } = useQuery({
    queryKey: ["admin_announcements"],
    queryFn: async () => {
      const { data, error } = await db.from("announcements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as Announcement[];
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin_announcements"] });
    void queryClient.invalidateQueries({ queryKey: ["announcements"] });
  };

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setImageFile(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setImageFile(null);
      setImageError("Please select an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setImageFile(null);
      setImageError("Image must be smaller than 2MB.");
      return;
    }
    setImageError("");
    setImageFile(file);
    setRemoveImage(false);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.title.trim() || !form.message.trim()) throw new Error("Title and message are required.");
      if (imageError) throw new Error(imageError);
      let imageUrl: string | null = editing?.image_url ?? null;
      let previousImageUrl: string | null = null;
      if (imageFile) {
        const storageRef = ref(firebaseStorage, `announcements/${Date.now()}-${imageFile.name}`);
        const snapshot = await uploadBytes(storageRef, imageFile);
        imageUrl = await getDownloadURL(snapshot.ref);
        previousImageUrl = editing?.image_url ?? null;
      } else if (removeImage) {
        imageUrl = null;
        previousImageUrl = editing?.image_url ?? null;
      }
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        type: form.type,
        audience: form.audience,
        is_active: form.is_active,
        expires_at: form.expires_at || null,
        image_url: imageUrl,
      } as never;
      if (editing) {
        const { error } = await db.from("announcements").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("announcements").insert(payload);
        if (error) throw error;
      }
      if (previousImageUrl && previousImageUrl !== imageUrl) {
        try {
          await deleteObject(refFromURL(firebaseStorage, previousImageUrl));
        } catch {}
      }
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY);
      setImageFile(null);
      setImageError("");
      setRemoveImage(false);
      toast.success("Announcement saved.");
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
    setImageFile(null);
    setImageError("");
    setRemoveImage(false);
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
    setImageFile(null);
    setImageError("");
    setRemoveImage(false);
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-4 sm:max-w-lg">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Announcements</h1>
            <p className="text-sm text-muted-foreground">Create banners and popups for users.</p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>New announcement</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit announcement" : "New announcement"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="ann-title">Title</Label>
                <Input id="ann-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Offer: 20% off plans" />
              </div>
              <div>
                <Label htmlFor="ann-message">Message</Label>
                <Textarea id="ann-message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Write the announcement exactly as users should see it." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="news">News</SelectItem>
                      <SelectItem value="offer">Offer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Audience</Label>
                  <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All users</SelectItem>
                      <SelectItem value="non_subscribers">Non-subscribers only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="ann-expiry">Expiry (optional)</Label>
                <DatePicker id="ann-expiry" value={form.expires_at} onChange={(v) => setForm({ ...form, expires_at: v ?? "" })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v === true })} />
                {"Active (shows to users)"}
              </label>
              <div className="space-y-2">
                <Label htmlFor="ann-image">Image (optional)</Label>
                <Input id="ann-image" type="file" accept="image/*" onChange={handleImageChange} />
                {imageError && <p className="text-sm text-red-500">{imageError}</p>}
                {editing?.image_url && !removeImage && !imageFile && (
                  <div className="space-y-2">
                    <img src={editing.image_url} alt="Current announcement image" className="h-32 w-auto rounded object-cover" />
                    <Button type="button" variant="outline" size="sm" onClick={() => setRemoveImage(true)}>
                      Remove image
                    </Button>
                  </div>
                )}
                {removeImage && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Image will be removed on save.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setRemoveImage(false)}>
                      Keep image
                    </Button>
                  </div>
                )}
                {imageFile && <p className="text-sm text-muted-foreground">{imageFile.name}</p>}
              </div>
              <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : editing ? "Update announcement" : "Create announcement"}
              </Button>
              <Button className="w-full" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-3">
        {announcements.length === 0 && <p className="text-sm text-muted-foreground">No announcements yet.</p>}
        {announcements.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Megaphone className="h-4 w-4" />
                {a.title ?? "Driver Saathi"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {a.type} · {a.audience}
                {a.expires_at ? ` · Expires ${a.expires_at}` : ""}
              </p>
              <p className="text-sm whitespace-pre-wrap">{a.message ?? ""}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(a)}>
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => toggleMutation.mutate(a)}>
                  {a.is_active ? "Deactivate" : "Activate"}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(a.id)}>
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
