
-- Protect app_config: deny all client access (service-role only)
CREATE POLICY "Deny all client access to app_config"
ON public.app_config
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- Protect sent_notifications: deny all client access (service-role only)  
CREATE POLICY "Deny all client access to sent_notifications"
ON public.sent_notifications
FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

-- Add UPDATE policy for push_subscriptions (needed for upsert)
CREATE POLICY "Users can update own push subscriptions"
ON public.push_subscriptions
FOR UPDATE
USING (auth.uid() = user_id);
