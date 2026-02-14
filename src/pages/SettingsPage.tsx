import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, LANGUAGES } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Globe, User, Car, LogOut, Save, ArrowLeft, Pencil, Camera } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ full_name: "", phone: "", vehicle_type: "", vehicle_number: "", license_number: "" });

  const { data: profile, isLoading } = useQuery({
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
      setEditing(false);
      toast.success("Profile updated!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be less than 2MB");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);

      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const { error: updateError } = await supabase.from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("user_id", user.id);
      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Profile picture updated!");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/auth");
  };

  const initials = (profile?.full_name || user?.email || "U")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const hasProfile = profile?.full_name || profile?.phone || profile?.vehicle_type;

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 pt-6">
      <button onClick={() => navigate("/more")} className="flex items-center gap-1 text-muted-foreground mb-2">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Avatar & Profile Card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="h-20 w-20 border-2 border-border">
                <AvatarImage src={profile?.avatar_url || undefined} alt="Profile" />
                <AvatarFallback className="text-lg font-semibold bg-muted">{initials}</AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5 text-primary-foreground shadow-md hover:opacity-90 transition-opacity"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-lg truncate">{profile?.full_name || "Set your name"}</p>
              <p className="text-muted-foreground truncate">{user?.email}</p>
              {profile?.phone && <p className="text-muted-foreground truncate">{profile.phone}</p>}
            </div>
          </div>
          {uploading && <p className="text-muted-foreground mt-2 text-center">Uploading...</p>}
        </CardContent>
      </Card>

      {/* Profile Details - View or Edit */}
      {!editing && hasProfile ? (
        <>
          {/* View Mode */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">Profile Details</span>
                </div>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              </div>
              <div className="grid gap-2">
                <ProfileRow label="Full Name" value={profile?.full_name} />
                <ProfileRow label="Phone" value={profile?.phone} />
                <ProfileRow label="Email" value={user?.email} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Car className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">Vehicle Details</span>
              </div>
              <div className="grid gap-2">
                <ProfileRow label="Type" value={profile?.vehicle_type} />
                <ProfileRow label="Number" value={profile?.vehicle_number} />
                <ProfileRow label="License" value={profile?.license_number} />
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Edit Mode */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2 mb-1">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">Profile</span>
              </div>
              <div><Label>Full Name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>Phone</Label><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 9876543210" /></div>
              <p className="text-muted-foreground">Email: {user?.email}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Car className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">Vehicle Details</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><Label>Type</Label><Input value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })} placeholder="Sedan, SUV..." /></div>
                <div><Label>Number</Label><Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} placeholder="MH 12 AB 1234" /></div>
              </div>
              <div><Label>License Number</Label><Input value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} /></div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            {hasProfile && (
              <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>Cancel</Button>
            )}
            <Button className="flex-1 gap-2" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              <Save className="h-4 w-4" /> {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </>
      )}

      {/* Language */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">Language</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((lang) => (
              <button key={lang.code} onClick={() => setLanguage(lang.code)}
                className={`rounded-full px-3 py-1.5 font-medium transition-colors ${language === lang.code ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {lang.nativeLabel}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button variant="destructive" className="w-full gap-2" onClick={handleLogout}>
        <LogOut className="h-4 w-4" /> {t("auth.logout")}
      </Button>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right truncate max-w-[60%]">{value || "—"}</span>
    </div>
  );
}
