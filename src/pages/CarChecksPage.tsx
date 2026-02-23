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
import { Plus, Wrench, Trash2, ArrowLeft, FileText, Pencil, Shield, Store, AlertTriangle, Phone, ExternalLink, UserCheck, FileCheck, Cog, GraduationCap, Image, Video, Play } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { format, parseISO, differenceInDays } from "date-fns";

const DEFAULT_CHECK_TYPES = ["Oil Change", "Tire Rotation", "Brake Check", "Battery", "Air Filter", "Coolant", "PUC", "Insurance", "Fitness Certificate", "General Service"];

const ICON_MAP: Record<string, any> = {
  Shield, UserCheck, FileCheck, Wrench, Cog, GraduationCap, Store,
};

export default function CarChecksPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"checks" | "documents" | "marketplace">("checks");
  const [open, setOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<any>(null);
  const [form, setForm] = useState({ check_type: "", description: "", odometer_reading: "", cost: "", check_date: new Date().toISOString().split("T")[0], next_due_date: "", notify_date: "", notify_time: "" });
  const [customType, setCustomType] = useState("");
  const [showCustomType, setShowCustomType] = useState(false);
  const [docForm, setDocForm] = useState({ document_name: "", expiry_date: "", notify_date: "", notify_time: "" });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Car checks query
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ["car_checks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("car_checks").select("*").order("check_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Car documents query
  const { data: documents = [], isLoading: docsLoading } = useQuery({
    queryKey: ["car_documents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("car_documents").select("*").order("expiry_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Marketplace categories
  const { data: categories = [] } = useQuery({
    queryKey: ["marketplace_categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketplace_categories").select("*").eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Marketplace posts
  const { data: posts = [] } = useQuery({
    queryKey: ["marketplace_posts", selectedCategory],
    queryFn: async () => {
      let query = supabase.from("marketplace_posts").select("*, marketplace_categories(name, icon)").eq("is_active", true).order("created_at", { ascending: false });
      if (selectedCategory) query = query.eq("category_id", selectedCategory);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const notifyAt = form.notify_date && form.notify_time ? `${form.notify_date}T${form.notify_time}:00` : form.notify_date ? `${form.notify_date}T09:00:00` : null;
      const { error } = await supabase.from("car_checks").insert({
        user_id: user!.id,
        check_type: form.check_type,
        description: form.description || null,
        odometer_reading: form.odometer_reading ? Number(form.odometer_reading) : null,
        cost: form.cost ? Number(form.cost) : 0,
        check_date: form.check_date,
        next_due_date: form.next_due_date || null,
        is_completed: true,
        notify_at: notifyAt,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["car_checks"] });
      setOpen(false);
      setForm({ check_type: "", description: "", odometer_reading: "", cost: "", check_date: new Date().toISOString().split("T")[0], next_due_date: "", notify_date: "", notify_time: "" });
      setCustomType(""); setShowCustomType(false);
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

  // Document CRUD
  const addDocMutation = useMutation({
    mutationFn: async () => {
      const notifyAt = docForm.notify_date && docForm.notify_time
        ? `${docForm.notify_date}T${docForm.notify_time}:00`
        : docForm.notify_date ? `${docForm.notify_date}T09:00:00`
        : docForm.expiry_date ? `${docForm.expiry_date}T09:00:00` : null;
      const { error } = await supabase.from("car_documents").insert({
        user_id: user!.id,
        document_name: docForm.document_name,
        expiry_date: docForm.expiry_date,
        notify_at: notifyAt,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["car_documents"] });
      queryClient.invalidateQueries({ queryKey: ["notifications_car_documents"] });
      setDocOpen(false);
      setDocForm({ document_name: "", expiry_date: "", notify_date: "", notify_time: "" });
      toast.success("Document added!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateDocMutation = useMutation({
    mutationFn: async () => {
      if (!editDoc) return;
      const notifyAt = docForm.notify_date && docForm.notify_time
        ? `${docForm.notify_date}T${docForm.notify_time}:00`
        : docForm.notify_date ? `${docForm.notify_date}T09:00:00`
        : docForm.expiry_date ? `${docForm.expiry_date}T09:00:00` : null;
      const { error } = await supabase.from("car_documents").update({
        document_name: docForm.document_name,
        expiry_date: docForm.expiry_date,
        notify_at: notifyAt,
      } as any).eq("id", editDoc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["car_documents"] });
      queryClient.invalidateQueries({ queryKey: ["notifications_car_documents"] });
      setEditDoc(null);
      setDocForm({ document_name: "", expiry_date: "", notify_date: "", notify_time: "" });
      toast.success("Document updated!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("car_documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["car_documents"] });
      queryClient.invalidateQueries({ queryKey: ["notifications_car_documents"] });
      toast.success("Document deleted");
    },
  });

  const openEditDoc = (doc: any) => {
    setEditDoc(doc);
    const notifyDate = doc.notify_at ? doc.notify_at.split("T")[0] : "";
    const notifyTime = doc.notify_at ? doc.notify_at.split("T")[1]?.substring(0, 5) : "";
    setDocForm({ document_name: doc.document_name, expiry_date: doc.expiry_date, notify_date: notifyDate, notify_time: notifyTime });
  };

  const getExpiryStatus = (expiryDate: string) => {
    const days = differenceInDays(parseISO(expiryDate), new Date());
    if (days < 0) return { label: "Expired", color: "text-destructive", bg: "bg-destructive/10" };
    if (days <= 30) return { label: `${days}d left`, color: "text-warning", bg: "bg-warning/10" };
    return { label: `${days}d left`, color: "text-success", bg: "bg-success/10" };
  };

  const getCategoryIcon = (iconName: string) => {
    const IconComponent = ICON_MAP[iconName] || Store;
    return <IconComponent className="h-5 w-5" />;
  };

  return (
    <div className="space-y-5 p-4 pt-6">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </button>

      {/* Toggle Switch - 3 tabs */}
      <div className="flex items-center justify-center">
        <div className="relative flex w-full max-w-md rounded-lg bg-muted p-1">
          <button
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${activeTab === "checks" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("checks")}
          >
            <Wrench className="h-3.5 w-3.5 inline mr-1" /> Car Checks
          </button>
          <button
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${activeTab === "documents" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("documents")}
          >
            <FileText className="h-3.5 w-3.5 inline mr-1" /> Documents
          </button>
          <button
            className={`flex-1 rounded-md py-2 text-xs font-medium transition-all ${activeTab === "marketplace" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("marketplace")}
          >
            <Store className="h-3.5 w-3.5 inline mr-1" /> Marketplace
          </button>
        </div>
      </div>

      {/* ===== CAR CHECKS TAB ===== */}
      {activeTab === "checks" && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{t("car.title")}</h1>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{t("car.addCheck")}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Type</Label>
                    <Select value={showCustomType ? "__custom__" : form.check_type} onValueChange={(v) => {
                      if (v === "__custom__") { setShowCustomType(true); setForm({ ...form, check_type: "" }); }
                      else { setShowCustomType(false); setCustomType(""); setForm({ ...form, check_type: v }); }
                    }}>
                      <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                      <SelectContent>
                        {DEFAULT_CHECK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        <SelectItem value="__custom__">+ Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    {showCustomType && <Input className="mt-1" placeholder="Enter custom type" value={customType} onChange={(e) => { setCustomType(e.target.value); setForm({ ...form, check_type: e.target.value }); }} />}
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
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Notify Date</Label><Input type="date" value={form.notify_date} onChange={(e) => setForm({ ...form, notify_date: e.target.value })} /></div>
                    <div><Label>Notify Time</Label><Input type="time" value={form.notify_time} onChange={(e) => setForm({ ...form, notify_time: e.target.value })} /></div>
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
            <Card><CardContent className="p-6 text-center text-muted-foreground">{t("car.noChecks")}</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {checks.map((c: any) => (
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
        </>
      )}

      {/* ===== DOCUMENTS TAB ===== */}
      {activeTab === "documents" && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Vehicle Documents</h1>
            <Dialog open={docOpen} onOpenChange={setDocOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Document</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Document Name</Label><Input placeholder="e.g. PUC Certificate, Insurance" value={docForm.document_name} onChange={(e) => setDocForm({ ...docForm, document_name: e.target.value })} /></div>
                  <div><Label>Expiry Date</Label><Input type="date" value={docForm.expiry_date} onChange={(e) => setDocForm({ ...docForm, expiry_date: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Notify Date</Label><Input type="date" value={docForm.notify_date} onChange={(e) => setDocForm({ ...docForm, notify_date: e.target.value })} /></div>
                    <div><Label>Notify Time</Label><Input type="time" value={docForm.notify_time} onChange={(e) => setDocForm({ ...docForm, notify_time: e.target.value })} /></div>
                  </div>
                  <Button className="w-full" onClick={() => addDocMutation.mutate()} disabled={!docForm.document_name || !docForm.expiry_date || addDocMutation.isPending}>
                    {addDocMutation.isPending ? "Saving..." : "Save Document"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {docsLoading ? (
            <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
          ) : documents.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">No documents added yet. Track your vehicle documents!</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {(documents as any[]).map((doc) => {
                const status = getExpiryStatus(doc.expiry_date);
                return (
                  <Card key={doc.id}>
                    <CardContent className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${status.bg}`}>
                          {differenceInDays(parseISO(doc.expiry_date), new Date()) < 0 ? (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          ) : (
                            <FileText className={`h-4 w-4 ${status.color}`} />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{doc.document_name}</p>
                          <p className="text-xs text-muted-foreground">
                            Expires: {format(parseISO(doc.expiry_date), "dd MMM yyyy")}
                            <span className={`ml-2 font-semibold ${status.color}`}>• {status.label}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDoc(doc)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteDocMutation.mutate(doc.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Edit Document Dialog */}
          <Dialog open={!!editDoc} onOpenChange={(o) => { if (!o) setEditDoc(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Edit Document</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Document Name</Label><Input value={docForm.document_name} onChange={(e) => setDocForm({ ...docForm, document_name: e.target.value })} /></div>
                <div><Label>Expiry Date</Label><Input type="date" value={docForm.expiry_date} onChange={(e) => setDocForm({ ...docForm, expiry_date: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Notify Date</Label><Input type="date" value={docForm.notify_date} onChange={(e) => setDocForm({ ...docForm, notify_date: e.target.value })} /></div>
                  <div><Label>Notify Time</Label><Input type="time" value={docForm.notify_time} onChange={(e) => setDocForm({ ...docForm, notify_time: e.target.value })} /></div>
                </div>
                <Button className="w-full" onClick={() => updateDocMutation.mutate()} disabled={!docForm.document_name || !docForm.expiry_date || updateDocMutation.isPending}>
                  {updateDocMutation.isPending ? "Saving..." : "Update Document"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* ===== MARKETPLACE TAB ===== */}
      {activeTab === "marketplace" && (
        <>
          <h1 className="text-2xl font-bold">Marketplace</h1>

          {/* Category pills */}
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all ${!selectedCategory ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              All
            </button>
            {(categories as any[]).map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 ${selectedCategory === cat.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              >
                {getCategoryIcon(cat.icon)}
                {cat.name}
              </button>
            ))}
          </div>

          {/* Posts */}
          {(posts as any[]).length === 0 ? (
            <Card><CardContent className="p-6 text-center text-muted-foreground">No listings yet. Check back soon!</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {(posts as any[]).map((post) => (
                <Card key={post.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    {/* Media */}
                    {post.post_type === "image" && post.media_url && (
                      <img src={post.media_url} alt={post.title} className="w-full h-48 object-cover" />
                    )}
                    {post.post_type === "video" && post.media_url && (
                      <video src={post.media_url} controls className="w-full h-48 object-cover" />
                    )}

                    <div className="p-4 space-y-2">
                      {/* Category badge */}
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                          {post.marketplace_categories?.name || "General"}
                        </span>
                        <span className="text-xs text-muted-foreground">{format(parseISO(post.created_at), "dd MMM yyyy")}</span>
                      </div>

                      <h3 className="font-bold text-sm">{post.title}</h3>
                      {post.description && <p className="text-xs text-muted-foreground leading-relaxed">{post.description}</p>}

                      {/* Contact */}
                      <div className="flex gap-2 pt-1">
                        {post.contact_phone && (
                          <a href={`tel:${post.contact_phone}`} className="flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-3 py-1 font-medium">
                            <Phone className="h-3 w-3" /> Call
                          </a>
                        )}
                        {post.contact_link && (
                          <a href={post.contact_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs bg-muted text-foreground rounded-full px-3 py-1 font-medium">
                            <ExternalLink className="h-3 w-3" /> Visit
                          </a>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
