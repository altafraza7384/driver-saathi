import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Helper to get or generate VAPID keys
    async function getVapidKeys() {
      const { data: configs } = await supabaseAdmin
        .from("app_config")
        .select("*")
        .in("key", ["vapid_public_key", "vapid_private_key"]);

      if (configs && configs.length === 2) {
        return {
          publicKey: configs.find((c: any) => c.key === "vapid_public_key")!.value,
          privateKey: configs.find((c: any) => c.key === "vapid_private_key")!.value,
        };
      }

      // Generate new VAPID keys
      const vapidKeys = webpush.generateVAPIDKeys();
      await supabaseAdmin.from("app_config").upsert([
        { key: "vapid_public_key", value: vapidKeys.publicKey },
        { key: "vapid_private_key", value: vapidKeys.privateKey },
      ]);
      return vapidKeys;
    }

    // GET = return VAPID public key (for client subscription)
    if (req.method === "GET") {
      const keys = await getVapidKeys();
      return new Response(
        JSON.stringify({ publicKey: keys.publicKey }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST = send due notifications (called by cron)
    // Verify authorization - only service role or valid cron calls allowed
    const authHeader = req.headers.get("Authorization");
    const apiKey = req.headers.get("apikey");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Accept if apikey header matches service role key, or Bearer token matches service role key
    const isAuthorized =
      apiKey === serviceRoleKey ||
      (authHeader && authHeader.replace("Bearer ", "") === serviceRoleKey);

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const keys = await getVapidKeys();
    webpush.setVapidDetails(
      "mailto:noreply@driverbuddy.app",
      keys.publicKey,
      keys.privateKey
    );

    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const fiveMinAgoISO = fiveMinAgo.toISOString();
    const nowISO = now.toISOString();

    // Collect due notifications from all sources
    const notifications: Array<{
      user_id: string;
      source_table: string;
      source_id: string;
      notify_at: string;
      title: string;
      body: string;
      url: string;
    }> = [];

    // 1. Reminders
    const { data: dueReminders } = await supabaseAdmin
      .from("reminders")
      .select("*")
      .eq("is_completed", false)
      .gte("notify_at", fiveMinAgoISO)
      .lte("notify_at", nowISO);

    for (const r of dueReminders || []) {
      notifications.push({
        user_id: r.user_id,
        source_table: "reminders",
        source_id: r.id,
        notify_at: r.notify_at,
        title: "🔔 Reminder: " + r.title,
        body: r.description || "Your reminder is due now!",
        url: "/reminders",
      });
    }

    // 2. Debts / EMI
    const { data: dueDebts } = await supabaseAdmin
      .from("debts")
      .select("*")
      .eq("is_active", true)
      .gte("notify_at", fiveMinAgoISO)
      .lte("notify_at", nowISO);

    for (const d of dueDebts || []) {
      notifications.push({
        user_id: d.user_id,
        source_table: "debts",
        source_id: d.id,
        notify_at: d.notify_at,
        title: "💰 EMI Due: " + d.name,
        body: `Your EMI of ₹${d.emi_amount} is due!`,
        url: "/debts",
      });
    }

    // 3. Car Checks
    const { data: dueCarChecks } = await supabaseAdmin
      .from("car_checks")
      .select("*")
      .eq("is_completed", false)
      .gte("notify_at", fiveMinAgoISO)
      .lte("notify_at", nowISO);

    for (const c of dueCarChecks || []) {
      notifications.push({
        user_id: c.user_id,
        source_table: "car_checks",
        source_id: c.id,
        notify_at: c.notify_at,
        title: "🚗 Car Check: " + c.check_type,
        body: c.description || "Your vehicle check is due!",
        url: "/car-checks",
      });
    }

    // 4. Car Documents (expiry reminders)
    const { data: dueCarDocs } = await supabaseAdmin
      .from("car_documents")
      .select("*")
      .gte("notify_at", fiveMinAgoISO)
      .lte("notify_at", nowISO);

    for (const doc of dueCarDocs || []) {
      const expiryDate = new Date(doc.expiry_date);
      const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const urgency = daysLeft <= 0 ? "EXPIRED" : daysLeft <= 3 ? "expires in " + daysLeft + " days!" : "expires on " + doc.expiry_date;
      notifications.push({
        user_id: doc.user_id,
        source_table: "car_documents",
        source_id: doc.id,
        notify_at: doc.notify_at,
        title: "📄 " + doc.document_name + " " + (daysLeft <= 0 ? "EXPIRED!" : "Expiring Soon!"),
        body: `Your ${doc.document_name} ${urgency}. Renew it now!`,
        url: "/car-checks",
      });
    }

    let sent = 0;
    let skipped = 0;

    for (const n of notifications) {
      // Check if already sent for this exact notify_at
      const { data: existing } = await supabaseAdmin
        .from("sent_notifications")
        .select("id")
        .eq("source_table", n.source_table)
        .eq("source_id", n.source_id)
        .eq("notify_at", n.notify_at)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Get user's push subscriptions
      const { data: subs } = await supabaseAdmin
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", n.user_id);

      for (const sub of subs || []) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify({ title: n.title, body: n.body, url: n.url })
          );
          sent++;
        } catch (err: any) {
          console.error("Push send error:", err.statusCode, err.body);
          // Remove expired subscriptions
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabaseAdmin
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id);
          }
        }
      }

      // Mark as sent
      await supabaseAdmin.from("sent_notifications").insert({
        user_id: n.user_id,
        source_table: n.source_table,
        source_id: n.source_id,
        notify_at: n.notify_at,
      });
    }

    return new Response(
      JSON.stringify({ sent, skipped, total: notifications.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("send-notifications error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
