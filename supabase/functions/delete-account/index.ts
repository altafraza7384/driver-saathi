import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = claimsData.claims.sub;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: avatarFiles, error: avatarListError } = await adminClient.storage.from("avatars").list(userId, { limit: 1000 });
    if (avatarListError) return new Response(JSON.stringify({ error: "Failed to delete account data" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const avatarPaths = (avatarFiles ?? []).filter((file) => file.name).map((file) => `${userId}/${file.name}`);
    if (avatarPaths.length) {
      const { error } = await adminClient.storage.from("avatars").remove(avatarPaths);
      if (error) return new Response(JSON.stringify({ error: "Failed to delete account data" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: cleanupError } = await adminClient.rpc("delete_user_data", { p_user_id: userId });
    if (cleanupError) {
      console.error("Error deleting user data:", cleanupError.message);
      return new Response(JSON.stringify({ error: "Failed to delete account data" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError) return new Response(JSON.stringify({ error: "Failed to delete account" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("delete-account error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
