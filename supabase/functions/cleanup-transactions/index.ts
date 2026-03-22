import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

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

    const isAuthorized =
      apiKey === serviceRoleKey ||
      (authHeader && authHeader.replace("Bearer ", "") === serviceRoleKey);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey
    );

    // Get VAPID keys for push notifications
    const { data: configs } = await supabaseAdmin
      .from("app_config")
      .select("*")
      .in("key", ["vapid_public_key", "vapid_private_key"]);

    const vapidPublic = configs?.find((c: any) => c.key === "vapid_public_key")?.value;
    const vapidPrivate = configs?.find((c: any) => c.key === "vapid_private_key")?.value;

    if (vapidPublic && vapidPrivate) {
      webpush.setVapidDetails("mailto:noreply@driverbuddy.app", vapidPublic, vapidPrivate);
    }

    const now = new Date();

    // --- STEP 1: Send reminder notifications for transactions 25-30 days old ---
    // Notify users who have transactions that will be deleted in ~5 days
    const reminderCutoff = new Date(now);
    reminderCutoff.setDate(reminderCutoff.getDate() - 25);
    const reminderCutoffStr = reminderCutoff.toISOString().split("T")[0];

    // Find distinct users with transactions older than 25 days
    const { data: usersToNotify } = await supabaseAdmin
      .from("transactions")
      .select("user_id")
      .lte("transaction_date", reminderCutoffStr);

    const uniqueUserIds = [...new Set((usersToNotify || []).map((t: any) => t.user_id))];

    let notified = 0;
    for (const userId of uniqueUserIds) {
      // Check if we already sent a cleanup reminder this month for this user
      const { data: alreadySent } = await supabaseAdmin
        .from("sent_notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("source_table", "cleanup_reminder")
        .gte("sent_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString())
        .maybeSingle();

      if (alreadySent) continue;

      // Send push notification
      if (vapidPublic && vapidPrivate) {
        const { data: subs } = await supabaseAdmin
          .from("push_subscriptions")
          .select("*")
          .eq("user_id", userId);

        for (const sub of subs || []) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({
                title: "📊 Backup Your Transactions!",
                body: "Your transactions older than 1 month will be auto-deleted soon. Go to More → Data Backup to save your data.",
                url: "/data-backup",
              })
            );
            notified++;
          } catch (err: any) {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
            }
          }
        }
      }

      // Record that we sent this reminder
      await supabaseAdmin.from("sent_notifications").insert({
        user_id: userId,
        source_table: "cleanup_reminder",
        source_id: userId,
        notify_at: now.toISOString(),
      });
    }

    // --- STEP 2: Delete transactions older than 30 days ---
    const deleteCutoff = new Date(now);
    deleteCutoff.setDate(deleteCutoff.getDate() - 30);
    const deleteCutoffStr = deleteCutoff.toISOString().split("T")[0];

    const { data: deleted, count } = await supabaseAdmin
      .from("transactions")
      .delete()
      .lte("transaction_date", deleteCutoffStr)
      .select("id");

    const deletedCount = deleted?.length || 0;

    return new Response(
      JSON.stringify({
        notified,
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
