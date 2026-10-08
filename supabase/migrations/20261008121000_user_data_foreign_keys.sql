-- Ensure all user-owned tables participate in auth account deletion.
-- Idempotent and tolerant of legacy/orphaned rows already present in production.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_expenses_user_id_fkey'
      AND conrelid = 'public.recurring_expenses'::regclass
  ) THEN
    ALTER TABLE public.recurring_expenses
      ADD CONSTRAINT recurring_expenses_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recurring_expense_payments_user_id_fkey'
      AND conrelid = 'public.recurring_expense_payments'::regclass
  ) THEN
    ALTER TABLE public.recurring_expense_payments
      ADD CONSTRAINT recurring_expense_payments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'marketplace_posts_created_by_fkey'
      AND conrelid = 'public.marketplace_posts'::regclass
  ) THEN
    ALTER TABLE public.marketplace_posts
      ADD CONSTRAINT marketplace_posts_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;
