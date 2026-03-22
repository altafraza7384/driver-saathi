import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const apiKey = req.headers.get("apikey");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const isAuthorized =
      apiKey === serviceRoleKey ||
      (authHeader && authHeader.replace("Bearer ", "") === serviceRoleKey);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const now = new Date();

    // --- STEP 1: Warn users with transactions 25+ days old (backup reminder) ---
    const reminderCutoff = new Date(now);
    reminderCutoff.setDate(reminderCutoff.getDate() - 25);
    const reminderCutoffStr = reminderCutoff.toISOString().split("T")[0];

    const { data: usersToNotify } = await supabaseAdmin
      .from("transactions")
      .select("user_id")
      .lte("transaction_date", reminderCutoffStr);

    const uniqueUserIds = [...new Set((usersToNotify || []).map((t: any) => t.user_id))];

    let remindersCreated = 0;
    for (const userId of uniqueUserIds) {
      // Check if we already created a cleanup reminder this month
      const { data: existing } = await supabaseAdmin
        .from("sent_notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("source_table", "cleanup_reminder")
        .gte("sent_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString())
        .maybeSingle();

      if (existing) continue;

      // Create a reminder that the existing send-notifications cron will pick up
      const notifyAt = new Date(now.getTime() + 60 * 1000).toISOString(); // notify in 1 min
      await supabaseAdmin.from("reminders").insert({
        user_id: userId,
        title: "📊 Backup Your Transactions!",
        description: "Your transactions older than 1 month will be auto-deleted soon. Go to More → Data Backup to save your data.",
        reminder_date: now.toISOString().split("T")[0],
        notify_at: notifyAt,
        category: "system",
        is_completed: false,
      });

      // Mark as sent so we don't duplicate
      await supabaseAdmin.from("sent_notifications").insert({
        user_id: userId,
        source_table: "cleanup_reminder",
        source_id: userId,
        notify_at: notifyAt,
      });

      remindersCreated++;
    }

    // --- STEP 2: Delete transactions older than 30 days ---
    const deleteCutoff = new Date(now);
    deleteCutoff.setDate(deleteCutoff.getDate() - 30);
    const deleteCutoffStr = deleteCutoff.toISOString().split("T")[0];

    const { data: deleted } = await supabaseAdmin
      .from("transactions")
      .delete()
      .lte("transaction_date", deleteCutoffStr)
      .select("id");

    const deletedCount = deleted?.length || 0;

    return new Response(
      JSON.stringify({
        remindersCreated,
        usersWarned: uniqueUserIds.length,
        deletedTransactions: deletedCount,
        deleteCutoff: deleteCutoffStr,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("cleanup-transactions error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
