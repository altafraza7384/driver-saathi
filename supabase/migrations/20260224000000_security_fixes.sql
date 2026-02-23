-- ============================================================
-- SECURITY FIX MIGRATION - 2026-02-24
-- Fixes all issues detected by Supabase Security Advisor:
--   ERROR:   Driver Personal Information Exposed to Public Access
--   ERROR:   Financial Transaction History Vulnerable to Unauthorized Access
--   WARNING: Vehicle Document Expiry Dates Exposed to Public
--   WARNING: Marketplace storage bucket is publicly accessible
--   WARNING: Admin access relies on client-side role check
--   WARNING: Marketplace posts and categories publicly readable
--   WARNING: VAPID keys stored in database accessible by service role
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. FIX: Driver Personal Information (profiles table)
--    Ensure RLS is enabled and NO public/anon read exists.
--    Add admin read policy via DB-level role check.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop any existing overly-permissive policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are publicly viewable" ON public.profiles;

-- Owner can read their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can read all profiles (server-side role check, not client-side)
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Ensure UPDATE and INSERT are restricted too
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 2. FIX: Financial Transaction History (transactions table)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Remove any public/anon access policies
DROP POLICY IF EXISTS "Public read transactions" ON public.transactions;
DROP POLICY IF EXISTS "Enable all for authenticated" ON public.transactions;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
CREATE POLICY "Users can update own transactions"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;
CREATE POLICY "Users can delete own transactions"
  ON public.transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can view all transactions
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.transactions;
CREATE POLICY "Admins can view all transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ─────────────────────────────────────────────────────────────
-- 3. FIX: Vehicle Document Expiry Dates Exposed to Public
--    (car_documents table)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.car_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read car_documents" ON public.car_documents;
DROP POLICY IF EXISTS "Car documents are publicly viewable" ON public.car_documents;

DROP POLICY IF EXISTS "Users can manage own car documents" ON public.car_documents;
CREATE POLICY "Users can view own car documents"
  ON public.car_documents FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own car documents"
  ON public.car_documents FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own car documents"
  ON public.car_documents FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own car documents"
  ON public.car_documents FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 4. FIX: Debts, Goals, Reminders, Health Logs, Notes, 
--    Car Checks - ensure strict user-only RLS
-- ─────────────────────────────────────────────────────────────
-- Debts
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read debts" ON public.debts;

-- Goals
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read goals" ON public.goals;

-- Health logs
ALTER TABLE public.health_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read health_logs" ON public.health_logs;

-- Notes
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read notes" ON public.notes;

-- Car checks
ALTER TABLE public.car_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read car_checks" ON public.car_checks;

-- Reminders
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read reminders" ON public.reminders;

-- Emergency contacts
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read emergency_contacts" ON public.emergency_contacts;

-- ─────────────────────────────────────────────────────────────
-- 5. FIX: Marketplace posts and categories publicly readable
--    Only authenticated users can read posts/categories.
--    Categories are read-only for authenticated drivers,
--    admin-writable only.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.marketplace_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_posts ENABLE ROW LEVEL SECURITY;

-- Drop any anon-accessible policies
DROP POLICY IF EXISTS "Anyone can view marketplace categories" ON public.marketplace_categories;
DROP POLICY IF EXISTS "Public read marketplace_categories" ON public.marketplace_categories;
DROP POLICY IF EXISTS "Anyone can view marketplace posts" ON public.marketplace_posts;
DROP POLICY IF EXISTS "Public read marketplace_posts" ON public.marketplace_posts;

-- Authenticated users can READ categories
DROP POLICY IF EXISTS "Authenticated users can view categories" ON public.marketplace_categories;
CREATE POLICY "Authenticated users can view categories"
  ON public.marketplace_categories FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can write categories
DROP POLICY IF EXISTS "Admins can manage categories" ON public.marketplace_categories;
CREATE POLICY "Admins can manage categories"
  ON public.marketplace_categories FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Authenticated users can READ active posts
DROP POLICY IF EXISTS "Authenticated users can view active posts" ON public.marketplace_posts;
CREATE POLICY "Authenticated users can view active posts"
  ON public.marketplace_posts FOR SELECT
  TO authenticated
  USING (is_active = true OR auth.uid() = user_id);

-- Users can manage their own posts
DROP POLICY IF EXISTS "Users can manage own posts" ON public.marketplace_posts;
CREATE POLICY "Users can insert own posts"
  ON public.marketplace_posts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own posts"
  ON public.marketplace_posts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own posts"
  ON public.marketplace_posts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can manage ALL posts
DROP POLICY IF EXISTS "Admins can manage all posts" ON public.marketplace_posts;
CREATE POLICY "Admins can manage all posts"
  ON public.marketplace_posts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─────────────────────────────────────────────────────────────
-- 6. FIX: Admin access relies on client-side role check
--    Enforce admin role at DB level using has_role() function.
--    The has_role() function is already SECURITY DEFINER,
--    which means it cannot be bypassed by client-side code.
--    Add explicit admin policies to all sensitive admin tables.
-- ─────────────────────────────────────────────────────────────

-- Secure user_roles table so only admins can change roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─────────────────────────────────────────────────────────────
-- 7. FIX: VAPID keys stored in database accessible by service role
--    Move VAPID keys to environment variables.
--    Delete them from app_config table.
-- ─────────────────────────────────────────────────────────────

-- Remove VAPID keys from database (should live in env vars only)
DELETE FROM public.app_config WHERE key IN ('vapid_public_key', 'vapid_private_key');

-- Secure app_config table - only admins can read/write config
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view app_config" ON public.app_config;
DROP POLICY IF EXISTS "Public read app_config" ON public.app_config;

DROP POLICY IF EXISTS "Admins can manage app_config" ON public.app_config;
CREATE POLICY "Admins can manage app_config"
  ON public.app_config FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ─────────────────────────────────────────────────────────────
-- 8. FIX: Storage - restrict marketplace bucket to authenticated
-- ─────────────────────────────────────────────────────────────

-- Ensure the marketplace bucket is NOT public
UPDATE storage.buckets
  SET public = false
  WHERE id = 'marketplace';

-- Drop old open policies if they exist
DROP POLICY IF EXISTS "Public read marketplace files" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view marketplace images" ON storage.objects;

-- Allow authenticated users to read marketplace files
DROP POLICY IF EXISTS "Authenticated read marketplace files" ON storage.objects;
CREATE POLICY "Authenticated read marketplace files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'marketplace');

-- Allow users to upload their own files
DROP POLICY IF EXISTS "Users can upload marketplace files" ON storage.objects;
CREATE POLICY "Users can upload marketplace files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'marketplace'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow users to update/delete their own files
DROP POLICY IF EXISTS "Users can manage own marketplace files" ON storage.objects;
CREATE POLICY "Users can update own marketplace files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'marketplace'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own marketplace files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'marketplace'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────────────────────
-- 9. Add index on user_id for performance with new RLS policies
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_car_documents_user_id ON public.car_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_posts_user_id ON public.marketplace_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_posts_is_active ON public.marketplace_posts(is_active);
