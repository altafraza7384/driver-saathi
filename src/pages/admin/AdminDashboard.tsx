import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Store, FileText, Users, LayoutDashboard, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const { data: postCount = 0 } = useQuery({
    queryKey: ["admin_post_count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("marketplace_posts").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: categoryCount = 0 } = useQuery({
    queryKey: ["admin_category_count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("marketplace_categories").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: userCount = 0 } = useQuery({
    queryKey: ["admin_user_count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  const stats = [
    { label: "Total Posts", value: postCount, icon: FileText, color: "bg-primary/10 text-primary" },
    { label: "Categories", value: categoryCount, icon: Store, color: "bg-warning/10 text-warning" },
    { label: "Users", value: userCount, icon: Users, color: "bg-success/10 text-success" },
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
      </div>
    </div>
  );
}
