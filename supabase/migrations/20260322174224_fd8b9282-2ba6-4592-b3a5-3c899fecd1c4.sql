-- Fix app_config: replace permissive deny with restrictive
DROP POLICY IF EXISTS "Deny all client access to app_config" ON public.app_config;

CREATE POLICY "Block all client access to app_config"
ON public.app_config
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- Fix sent_notifications: replace permissive deny with restrictive
DROP POLICY IF EXISTS "Deny all client access to sent_notifications" ON public.sent_notifications;

CREATE POLICY "Block all client access to sent_notifications"
ON public.sent_notifications
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);