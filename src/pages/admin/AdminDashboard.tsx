import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/backend";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Store, FileText, Users, LayoutDashboard, LogOut, CreditCard, Tag, Wrench, Siren, Shield, Megaphone } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  // Counters use list length, not count-exact queries: the count path
  // returned 0 for leads/users while the detail pages showed real
  // numbers, so this matches the detail pages (incl. held count below).
  const { data: postCount = 0 } = useQuery({
    queryKey: ["admin_post_count"],
    queryFn: async () => {
      const { data, error } = await db.from("marketplace_posts").select("*");
      if (error) throw error;
      return (data ?? []).length;
    },
  });

  const { data: categoryCount = 0 } = useQuery({
    queryKey: ["admin_category_count"],
    queryFn: async () => {
      const { data, error } = await db.from("marketplace_categories").select("*");
      if (error) throw error;
      return (data ?? []).length;
    },
  });

  const { data: userCount = 0 } = useQuery({
    queryKey: ["admin_user_count"],
    queryFn: async () => {
      const { data, error } = await db.from("users").select("*");
      if (error) throw error;
      return (data ?? []).length;
    },
  });

  const { data: mechanicCount = 0 } = useQuery({
    queryKey: ["admin_mechanic_count"],
    queryFn: async () => {
      const { data, error } = await db.from("mechanics").select("*");
      if (error) throw error;
      return (data ?? []).length;
    },
  });

  const { data: pendingSosCount = 0 } = useQuery({
    queryKey: ["admin_pending_sos_count"],
    queryFn: async () => {
      const { data, error } = await db.from("sos_requests").select("status");
      if (error) throw error;
      return (data as { status?: string }[]).filter((s) => s.status === "pending").length;
    },
  });

  const { data: heldMechanicCount = 0 } = useQuery({
    queryKey: ["admin_held_mechanic_count"],
    queryFn: async () => {
      const { data, error } = await db.from("mechanics").select("status");
      if (error) throw error;
      return (data as { status?: string }[]).filter((m) => m.status === "held").length;
    },
  });

  const { data: insuranceLeadCount = 0 } = useQuery({
    queryKey: ["admin_insurance_lead_count"],
    queryFn: async () => {
      const { data, error } = await db.from("insurance_leads").select("*");
      if (error) throw error;
      return (data ?? []).length;
    },
  });

  const stats = [
    { label: "Insurance Leads", value: insuranceLeadCount, icon: Shield, color: "bg-success/10 text-success" },
    { label: "Total Posts", value: postCount, icon: FileText, color: "bg-primary/10 text-primary" },
    { label: "Categories", value: categoryCount, icon: Store, color: "bg-warning/10 text-warning" },
    { label: "Users", value: userCount, icon: Users, color: "bg-success/10 text-success" },
    { label: "Mechanics", value: mechanicCount, icon: Wrench, color: "bg-primary/10 text-primary" },
    { label: "Pending SOS", value: pendingSosCount, icon: Siren, color: "bg-warning/10 text-warning" },
    { label: "Held Mechanics", value: heldMechanicCount, icon: Wrench, color: "bg-destructive/10 text-destructive" },
  ];

  return (
    <div className="p-4 pt-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Admin Panel</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { signOut(); navigate("/auth"); }}>
          <LogOut className="h-4 w-4 mr-1" /> Logout
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 text-center">
              <div className={`mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg ${s.color}`}>
                <s.icon className="h-5 w-5" />
              </div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/posts")}>
          <FileText className="h-5 w-5 text-primary" />
          <div className="text-left">
            <p className="font-bold text-sm">Manage Posts</p>
            <p className="text-xs text-muted-foreground">Create, edit & delete marketplace ads</p>
          </div>
        </Button>
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/categories")}>
          <Store className="h-5 w-5 text-warning" />
          <div className="text-left">
            <p className="font-bold text-sm">Manage Categories</p>
            <p className="text-xs text-muted-foreground">Add or edit marketplace categories</p>
          </div>
        </Button>
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/users")}>
          <Users className="h-5 w-5 text-success" />
          <div className="text-left">
            <p className="font-bold text-sm">Manage Users</p>
            <p className="text-xs text-muted-foreground">View all users and their saved data</p>
          </div>
        </Button>
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/plans")}>
          <CreditCard className="h-5 w-5 text-primary" />
          <div className="text-left">
            <p className="font-bold text-sm">Subscription Plans</p>
            <p className="text-xs text-muted-foreground">Create & edit plans (payments later)</p>
          </div>
        </Button>
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/offers")}>
          <Tag className="h-5 w-5 text-primary" />
          <div className="text-left">
            <p className="font-bold text-sm">{"Manage Offers"}</p>
            <p className="text-xs text-muted-foreground">{"Discount offers for subscription plans"}</p>
          </div>
        </Button>
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/mechanics")}>
          <Wrench className="h-5 w-5 text-success" />
          <div className="text-left">
            <p className="font-bold text-sm">{"Manage Mechanics"}</p>
            <p className="text-xs text-muted-foreground">{"Warnings, holds and mechanic performance"}</p>
          </div>
        </Button>
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/insurance-leads")}>
          <Shield className="h-5 w-5 text-success" />
          <div className="text-left">
            <p className="font-bold text-sm">{"Insurance Leads"}</p>
            <p className="text-xs text-muted-foreground">{"Private leads, status and commission tracking"}</p>
          </div>
        </Button>
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/announcements")}>
          <Megaphone className="h-5 w-5 text-primary" />
          <div className="text-left">
            <p className="font-bold text-sm">{"Announcements"}</p>
            <p className="text-xs text-muted-foreground">{"Custom news and subscription offers — banner + popup, push staged"}</p>
          </div>
        </Button>
        <Button className="w-full justify-start gap-3 h-14" variant="outline" onClick={() => navigate("/admin/sos")}>
          <Siren className="h-5 w-5 text-warning" />
          <div className="text-left">
            <p className="font-bold text-sm">{"SOS Requests"}</p>
            <p className="text-xs text-muted-foreground">{"All Car SOS requests and their status"}</p>
          </div>
        </Button>
      </div>
    </div>
  );
}
