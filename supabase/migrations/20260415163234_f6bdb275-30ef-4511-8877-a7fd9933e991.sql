
-- Fix RLS policies: change from 'public' role to 'authenticated' role for 8 tables

-- === car_checks ===
DROP POLICY IF EXISTS "Users can view own car checks" ON public.car_checks;
DROP POLICY IF EXISTS "Users can insert own car checks" ON public.car_checks;
DROP POLICY IF EXISTS "Users can update own car checks" ON public.car_checks;
DROP POLICY IF EXISTS "Users can delete own car checks" ON public.car_checks;

CREATE POLICY "Users can view own car checks" ON public.car_checks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own car checks" ON public.car_checks FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own car checks" ON public.car_checks FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own car checks" ON public.car_checks FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- === car_documents ===
DROP POLICY IF EXISTS "Users can view own car documents" ON public.car_documents;
DROP POLICY IF EXISTS "Users can insert own car documents" ON public.car_documents;
DROP POLICY IF EXISTS "Users can update own car documents" ON public.car_documents;
DROP POLICY IF EXISTS "Users can delete own car documents" ON public.car_documents;

CREATE POLICY "Users can view own car documents" ON public.car_documents FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own car documents" ON public.car_documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own car documents" ON public.car_documents FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own car documents" ON public.car_documents FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- === chat_messages ===
DROP POLICY IF EXISTS "Users can view own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can delete own chat messages" ON public.chat_messages;

CREATE POLICY "Users can view own chat messages" ON public.chat_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chat messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own chat messages" ON public.chat_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- === emergency_contacts ===
DROP POLICY IF EXISTS "Users can view own emergency contacts" ON public.emergency_contacts;
DROP POLICY IF EXISTS "Users can insert own emergency contacts" ON public.emergency_contacts;
DROP POLICY IF EXISTS "Users can update own emergency contacts" ON public.emergency_contacts;
DROP POLICY IF EXISTS "Users can delete own emergency contacts" ON public.emergency_contacts;

CREATE POLICY "Users can view own emergency contacts" ON public.emergency_contacts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own emergency contacts" ON public.emergency_contacts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own emergency contacts" ON public.emergency_contacts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own emergency contacts" ON public.emergency_contacts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- === health_logs ===
DROP POLICY IF EXISTS "Users can view own health logs" ON public.health_logs;
DROP POLICY IF EXISTS "Users can insert own health logs" ON public.health_logs;
DROP POLICY IF EXISTS "Users can update own health logs" ON public.health_logs;
DROP POLICY IF EXISTS "Users can delete own health logs" ON public.health_logs;

CREATE POLICY "Users can view own health logs" ON public.health_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own health logs" ON public.health_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own health logs" ON public.health_logs FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own health logs" ON public.health_logs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- === notes ===
DROP POLICY IF EXISTS "Users can view own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can insert own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can update own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON public.notes;

CREATE POLICY "Users can view own notes" ON public.notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own notes" ON public.notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notes" ON public.notes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own notes" ON public.notes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- === push_subscriptions ===
DROP POLICY IF EXISTS "Users can view own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can insert own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can update own push subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON public.push_subscriptions;

CREATE POLICY "Users can view own push subscriptions" ON public.push_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own push subscriptions" ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own push subscriptions" ON public.push_subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own push subscriptions" ON public.push_subscriptions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- === reminders ===
DROP POLICY IF EXISTS "Users can view own reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can insert own reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can update own reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can delete own reminders" ON public.reminders;

CREATE POLICY "Users can view own reminders" ON public.reminders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reminders" ON public.reminders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reminders" ON public.reminders FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own reminders" ON public.reminders FOR DELETE TO authenticated USING (auth.uid() = user_id);
