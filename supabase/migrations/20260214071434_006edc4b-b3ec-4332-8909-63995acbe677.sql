
-- App config table for storing VAPID keys (service role only)
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- No RLS policies = only service role can access

-- Push subscriptions table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, endpoint)
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own push subscriptions"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own push subscriptions"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subscriptions"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

-- Sent notifications tracking (service role only)
CREATE TABLE IF NOT EXISTS public.sent_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  notify_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_table, source_id, notify_at)
);
ALTER TABLE public.sent_notifications ENABLE ROW LEVEL SECURITY;
-- No RLS policies = only service role can access

-- Enable extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
