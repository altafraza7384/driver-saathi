import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user with their token
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
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

    const userId = claimsData.claims.sub;

    // Use service role to delete all user data
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Delete from all user-owned tables. Child rows come first where foreign keys exist.
    const tables = [
      "transactions",
      "debt_payments",
      "recurring_expense_payments",
      "debts",
      "goals",
      "health_logs",
      "car_checks",
      "car_documents",
      "chat_messages",
      "emergency_contacts",
      "notes",
      "platform_affiliations",
      "push_subscriptions",
      "reminders",
      "recurring_expenses",
      "sent_notifications",
      "ai_usage_buckets",
      "profiles",
      "user_roles",
    ];

    for (const table of tables) {
      const { error } = await adminClient.from(table).delete().eq("user_id", userId);
      if (error) {
        console.error(`Error deleting from ${table}:`, error.message);
        return new Response(JSON.stringify({ error: "Failed to delete account data" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Remove avatar files stored under the user's folder.
    const { data: avatarFiles, error: avatarListError } = await adminClient.storage
      .from("avatars")
      .list(userId, { limit: 1000 });
    if (avatarListError) {
      console.error("Error listing avatar files:", avatarListError.message);
      return new Response(JSON.stringify({ error: "Failed to delete account data" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (avatarFiles?.length) {
      const avatarPaths = avatarFiles
        .filter((file) => file.name)
        .map((file) => `${userId}/${file.name}`);
      if (avatarPaths.length) {
        const { error: avatarDeleteError } = await adminClient.storage
          .from("avatars")
          .remove(avatarPaths);
        if (avatarDeleteError) {
          console.error("Error deleting avatar files:", avatarDeleteError.message);
          return new Response(JSON.stringify({ error: "Failed to delete account data" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Delete user from auth
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error("Error deleting auth user:", deleteAuthError.message);
      return new Response(
        JSON.stringify({ error: "Failed to delete account" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-account error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
