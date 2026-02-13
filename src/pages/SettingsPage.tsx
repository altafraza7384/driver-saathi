import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, LANGUAGES } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Globe, User, Car, LogOut, Save } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ full_name: "", phone: "", vehicle_type: "", vehicle_number: "", license_number: "" });

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", user!.id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name || "",
        phone: profile.phone || "",
        vehicle_type: profile.vehicle_type || "",
        vehicle_number: profile.vehicle_number || "",
        license_number: profile.license_number || "",
      });
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("profiles").update({
        full_name: form.full_name, phone: form.phone,
        vehicle_type: form.vehicle_type, vehicle_number: form.vehicle_number,
        license_number: form.license_number, preferred_language: language,
      }).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Profile updated!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleLogout = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="space-y-5 p-4 pt-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Profile */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 mb-1"><User className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-semibold">Profile</span></div>
          <div><Label>Full Name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label>Phone</Label><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 9876543210" /></div>
          <p className="text-xs text-muted-foreground">Email: {user?.email}</p>
        </CardContent>
      </Card>

      {/* Vehicle */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2 mb-1"><Car className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-semibold">Vehicle Details</span></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>Type</Label><Input value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })} placeholder="Sedan, SUV..." /></div>
            <div><Label>Number</Label><Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} placeholder="MH 12 AB 1234" /></div>
          </div>
          <div><Label>License Number</Label><Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} /></div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-semibold">Language</span></div>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((lang) => (
              <button key={lang.code} onClick={() => setLanguage(lang.code)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${language === lang.code ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {lang.nativeLabel}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button className="w-full gap-2" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
        <Save className="h-4 w-4" /> {updateMutation.isPending ? "Saving..." : "Save Changes"}
      </Button>

      <Button variant="destructive" className="w-full gap-2" onClick={handleLogout}>
        <LogOut className="h-4 w-4" /> {t("auth.logout")}
      </Button>
    </div>
  );
}
