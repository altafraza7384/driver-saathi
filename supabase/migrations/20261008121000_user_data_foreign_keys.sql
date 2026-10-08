-- Ensure all user-owned tables participate in auth account deletion.

ALTER TABLE public.recurring_expenses
  ADD CONSTRAINT recurring_expenses_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.recurring_expense_payments
  ADD CONSTRAINT recurring_expense_payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.marketplace_posts
  ADD CONSTRAINT marketplace_posts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
