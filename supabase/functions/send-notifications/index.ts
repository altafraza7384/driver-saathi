// deno-lint-ignore-file
/* eslint-disable @typescript-eslint/no-explicit-any */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Generic error response — no internal details leaked to client
function errorResponse(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ────────────────────────────────────────────────────────
    // FIX: VAPID keys from environment variables (NOT database)
    // Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Supabase
    // Edge Function secrets, not in app_config table.
    // ────────────────────────────────────────────────────────
    function getVapidKeys() {
      const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
      const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");

      if (!publicKey || !privateKey) {
        throw new Error("VAPID keys not configured in environment");
      }

      return { publicKey, privateKey };
    }

    // GET = return VAPID public key (for client subscription)
    if (req.method === "GET") {
      const keys = getVapidKeys();
      return new Response(
        JSON.stringify({ publicKey: keys.publicKey }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ────────────────────────────────────────────────────────
    // FIX: POST auth — use a dedicated CRON_SECRET env var
    // instead of exposing the service role key in the apikey header.
    // Set CRON_SECRET in Supabase Edge Function secrets and
    // pass it as Authorization: Bearer <CRON_SECRET> from your cron.
    // ────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    const cronSecret = Deno.env.get("CRON_SECRET");

    if (!authHeader || !cronSecret) {
      return errorResponse(401, "Unauthorized");
    }

    const providedToken = authHeader.replace("Bearer ", "").trim();
    if (providedToken !== cronSecret) {
      return errorResponse(401, "Unauthorized");
    }

    const keys = getVapidKeys();
    webpush.setVapidDetails(
      "mailto:noreply@driversaathi.app",
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
      .select("id, user_id, title, description, notify_at") // select only needed columns
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
      .select("id, user_id, name, emi_amount, notify_at") // select only needed columns
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
      .select("id, user_id, check_type, description, notify_at") // select only needed columns
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
        .select("id, endpoint, p256dh, auth")
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
          // FIX: Verbose error messages - log internally, don't expose to client
          console.error("Push send error - statusCode:", err.statusCode);
          // Remove expired subscriptions (410 = Gone, 404 = Not Found)
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
    // FIX: Verbose error messages - never expose raw error details to client
    console.error("send-notifications error:", err);
    return errorResponse(500, "Internal server error");
  }
});
