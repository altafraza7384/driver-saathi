-- Production account-deletion hardening.
-- Keeps user-owned database cleanup atomic before auth.users is removed.

CREATE OR REPLACE FUNCTION public.delete_user_data(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.recurring_expense_payments WHERE user_id = p_user_id;
  DELETE FROM public.recurring_expenses WHERE user_id = p_user_id;
  DELETE FROM public.debt_payments WHERE user_id = p_user_id;
  DELETE FROM public.sent_notifications WHERE user_id = p_user_id;
  DELETE FROM public.push_subscriptions WHERE user_id = p_user_id;
  DELETE FROM public.chat_messages WHERE user_id = p_user_id;
  DELETE FROM public.emergency_contacts WHERE user_id = p_user_id;
  DELETE FROM public.car_documents WHERE user_id = p_user_id;
  DELETE FROM public.car_checks WHERE user_id = p_user_id;
  DELETE FROM public.health_logs WHERE user_id = p_user_id;
  DELETE FROM public.notes WHERE user_id = p_user_id;
  DELETE FROM public.reminders WHERE user_id = p_user_id;
  DELETE FROM public.goals WHERE user_id = p_user_id;
  DELETE FROM public.debts WHERE user_id = p_user_id;
  DELETE FROM public.transactions WHERE user_id = p_user_id;
  DELETE FROM public.platform_affiliations WHERE user_id = p_user_id;
  DELETE FROM public.profiles WHERE user_id = p_user_id;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
  DELETE FROM public.ai_usage_buckets WHERE user_id = p_user_id;
  DELETE FROM public.marketplace_posts WHERE created_by = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_data(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_user_data(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.delete_user_data(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_data(UUID) TO service_role;
