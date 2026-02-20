import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertTriangle, Phone, Plus, Trash2, MapPin, ArrowLeft, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

export default function SOSPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sosTriggered, setSosTriggered] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", relationship: "" });

  const { data: contacts = [] } = useQuery({
    queryKey: ["emergency_contacts"],
    queryFn: async () => { const { data, error } = await supabase.from("emergency_contacts").select("*").order("is_primary", { ascending: false }); if (error) throw error; return data; },
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("emergency_contacts").insert({ user_id: user!.id, name: form.name, phone: form.phone, relationship: form.relationship || null, is_primary: contacts.length === 0 }); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["emergency_contacts"] }); setOpen(false); setForm({ name: "", phone: "", relationship: "" }); toast.success("✅"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("emergency_contacts").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["emergency_contacts"] }),
  });

  const shareWhatsApp = () => {
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); return; }
    toast.info("Getting location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const mapsUrl = `https://maps.google.com/maps?q=${latitude},${longitude}`;
        const message = `🚨 SOS EMERGENCY! I need help! My live location: ${mapsUrl}`;
        if (contacts.length > 0) {
          const firstContact = contacts[0];
          const phone = firstContact.phone.replace(/\D/g, "");
          const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
          window.open(waUrl, "_blank");
          toast.success(`Opening WhatsApp for ${firstContact.name}`);
        } else {
          const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
          window.open(waUrl, "_blank");
          toast.success("Opening WhatsApp to share location");
        }
      },
      () => { toast.error("Could not get location. Please enable GPS."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const triggerSOS = () => {
    setSosTriggered(true);
    if (!navigator.geolocation) { toast.error("Geolocation not supported"); setSosTriggered(false); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const mapsUrl = `https://maps.google.com/maps?q=${latitude},${longitude}`;
        const message = `🚨 SOS EMERGENCY! I need help! My live location: ${mapsUrl}`;
        toast.success(`Location captured: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        if (contacts.length > 0) {
          const phones = contacts.map((c) => c.phone.replace(/\s+/g, "")).join(",");
          const smsUrl = `sms:${phones}?body=${encodeURIComponent(message)}`;
          window.open(smsUrl, "_self");
          toast.info(`Opening SMS to ${contacts.length} contact(s)`);
        } else {
          if (navigator.share) navigator.share({ title: "🚨 SOS Emergency", text: message, url: mapsUrl }).catch(() => {});
          else { navigator.clipboard.writeText(message); toast.info("Location copied!"); }
        }
        setTimeout(() => setSosTriggered(false), 3000);
      },
      () => { toast.error("Could not get location. Please enable GPS."); setSosTriggered(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="space-y-5 p-4 pt-6">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-sm text-muted-foreground mb-2"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
      <h1 className="text-2xl font-bold">{t("sos.title")}</h1>

      <motion.div className="flex justify-center py-4" animate={sosTriggered ? { scale: [1, 1.05, 1] } : {}} transition={{ repeat: sosTriggered ? Infinity : 0, duration: 0.5 }}>
        <button onClick={triggerSOS} className="flex h-40 w-40 flex-col items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-2xl transition-transform active:scale-95">
          <AlertTriangle className="h-12 w-12" /><span className="mt-2 text-lg font-extrabold">SOS</span><span className="text-xs opacity-80">{t("sos.tapForHelp")}</span>
        </button>
      </motion.div>

      {/* WhatsApp Share Button */}
      <button
        onClick={shareWhatsApp}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground p-3 font-extrabold shadow-md active:scale-95 transition-transform"
      >
        <MessageCircle className="h-5 w-5" />
        Share Location on WhatsApp
      </button>

      {sosTriggered && (
        <Card className="border-destructive/30 bg-destructive/5"><CardContent className="flex items-center gap-3 p-4"><MapPin className="h-5 w-5 text-destructive" /><p className="text-sm font-medium text-destructive">{t("sos.gettingLocation")}</p></CardContent></Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("sos.emergencyContacts")}</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline" className="gap-1"><Plus className="h-4 w-4" /> {t("common.add")}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("sos.addContact")}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>{t("sos.name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>{t("sos.phone")}</Label><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 9876543210" /></div>
              <div><Label>{t("sos.relationship")}</Label><Input value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} /></div>
              <Button className="w-full" onClick={() => addMutation.mutate()} disabled={!form.name || !form.phone || addMutation.isPending}>{addMutation.isPending ? t("common.saving") : t("common.save")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {contacts.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">{t("sos.noContacts")}</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <Card key={c.id}><CardContent className="flex items-center justify-between p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10 text-destructive"><Phone className="h-4 w-4" /></div>
                <div><p className="text-sm font-medium">{c.name}{c.is_primary && <span className="ml-1 text-xs text-primary">({t("sos.primary")})</span>}</p><p className="text-xs text-muted-foreground">{c.phone}{c.relationship ? ` • ${c.relationship}` : ""}</p></div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}