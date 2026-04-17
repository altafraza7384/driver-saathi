import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claimsData.claims.sub;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is admin
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all auth users (paginate)
    const allUsers: any[] = [];
    let page = 1;
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      allUsers.push(...data.users);
      if (data.users.length < 1000) break;
      page++;
    }

    const userIds = allUsers.map((u) => u.id);

    // Fetch profiles
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, phone, vehicle_type, vehicle_number, license_number, preferred_language, avatar_url")
      .in("user_id", userIds);

    // Fetch counts per table
    const tables = [
      "transactions",
      "notes",
      "reminders",
      "debts",
      "goals",
      "health_logs",
      "car_checks",
      "car_documents",
      "emergency_contacts",
      "platform_affiliations",
    ];

    const counts: Record<string, Record<string, number>> = {};
    for (const id of userIds) counts[id] = {};

    for (const table of tables) {
      const { data } = await admin.from(table).select("user_id");
      for (const row of data || []) {
        const uid = (row as any).user_id;
        if (counts[uid]) counts[uid][table] = (counts[uid][table] || 0) + 1;
      }
    }

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    const users = allUsers.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      provider: u.app_metadata?.provider || "email",
      profile: profileMap.get(u.id) || null,
      counts: counts[u.id] || {},
    }));

    return new Response(JSON.stringify({ users }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("admin-list-users error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
