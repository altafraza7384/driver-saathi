import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, ArrowLeft, Pencil, Image, Video, FileText } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";

export default function AdminPostsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editPost, setEditPost] = useState<any>(null);
  const [form, setForm] = useState({
    title: "", description: "", category_id: "", post_type: "text",
    contact_phone: "", contact_link: "", media_url: "",
  });
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ["admin_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_categories").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["admin_posts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_posts").select("*, marketplace_categories(name)").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const uploadMedia = async (file: File): Promise<string> => {
    const ext = file.name.split(".").pop();
    const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("marketplace").upload(path, file);
    if (error) throw error;
    const { data: urlData } = supabase.storage.from("marketplace").getPublicUrl(path);
    return urlData.publicUrl;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      setUploading(true);
      let mediaUrl = form.media_url;
      if (mediaFile) {
        mediaUrl = await uploadMedia(mediaFile);
      }

      const payload = {
        title: form.title,
        description: form.description || null,
        category_id: form.category_id,
        post_type: form.post_type,
        contact_phone: form.contact_phone || null,
        contact_link: form.contact_link || null,
        media_url: mediaUrl || null,
        created_by: user!.id,
        is_active: true,
      };

      if (editPost) {
        const { error } = await supabase.from("marketplace_posts").update(payload as any).eq("id", editPost.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("marketplace_posts").insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_posts"] });
      resetForm();
      toast.success(editPost ? "Post updated!" : "Post created!");
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setUploading(false),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("marketplace_posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_posts"] });
      toast.success("Post deleted");
    },
  });

  const resetForm = () => {
    setOpen(false);
    setEditPost(null);
    setMediaFile(null);
    setForm({ title: "", description: "", category_id: "", post_type: "text", contact_phone: "", contact_link: "", media_url: "" });
  };

  const openEdit = (post: any) => {
    setEditPost(post);
    setForm({
      title: post.title,
      description: post.description || "",
      category_id: post.category_id,
      post_type: post.post_type,
      contact_phone: post.contact_phone || "",
      contact_link: post.contact_link || "",
      media_url: post.media_url || "",
    });
    setOpen(true);
  };

  const getTypeIcon = (type: string) => {
    if (type === "image") return <Image className="h-4 w-4" />;
    if (type === "video") return <Video className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  return (
    <div className="p-4 pt-6 space-y-5 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/admin")} className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); else setOpen(true); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New Post</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editPost ? "Edit Post" : "Create Post"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Category</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {(categories as any[]).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Post Type</Label>
                <Select value={form.post_type} onValueChange={(v) => setForm({ ...form, post_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text Post</SelectItem>
                    <SelectItem value="image">Image Post</SelectItem>
                    <SelectItem value="video">Video Post</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Post title" /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Post description" rows={3} /></div>

              {(form.post_type === "image" || form.post_type === "video") && (
                <div>
                  <Label>Upload {form.post_type === "image" ? "Image" : "Video"}</Label>
                  <Input
                    type="file"
                    accept={form.post_type === "image" ? "image/*" : "video/*"}
                    onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                  />
                  {form.media_url && !mediaFile && (
                    <p className="text-xs text-muted-foreground mt-1">Current media attached. Upload new to replace.</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div><Label>Contact Phone</Label><Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder="+91..." /></div>
                <div><Label>Website Link</Label><Input value={form.contact_link} onChange={(e) => setForm({ ...form, contact_link: e.target.value })} placeholder="https://..." /></div>
              </div>

              <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={!form.title || !form.category_id || saveMutation.isPending || uploading}>
                {uploading ? "Uploading..." : saveMutation.isPending ? "Saving..." : editPost ? "Update Post" : "Create Post"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <h1 className="text-2xl font-bold">Marketplace Posts</h1>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
      ) : (posts as any[]).length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No posts yet. Create your first marketplace ad!</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {(posts as any[]).map((post) => (
            <Card key={post.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {getTypeIcon(post.post_type)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{post.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {(post as any).marketplace_categories?.name} • {format(parseISO(post.created_at), "dd MMM")}
                    </p>
                  </div>
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(post)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteMutation.mutate(post.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
