CREATE TABLE IF NOT EXISTS public.ai_usage_buckets (
  user_id UUID NOT NULL,
  feature TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, feature, bucket_start)
);
REVOKE ALL ON TABLE public.ai_usage_buckets FROM anon, authenticated;
GRANT ALL ON TABLE public.ai_usage_buckets TO service_role;
ALTER TABLE public.ai_usage_buckets ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ai_usage_buckets_bucket_start_idx ON public.ai_usage_buckets (bucket_start);

CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_user_id UUID, p_feature TEXT, p_limit INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bucket TIMESTAMPTZ := date_trunc('hour', now());
  v_count INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_feature IS NULL OR length(trim(p_feature)) = 0 OR p_limit < 1 THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.ai_usage_buckets (user_id, feature, bucket_start, request_count)
  VALUES (p_user_id, p_feature, v_bucket, 1)
  ON CONFLICT (user_id, feature, bucket_start)
  DO UPDATE SET request_count = public.ai_usage_buckets.request_count + 1
    WHERE public.ai_usage_buckets.request_count < p_limit
  RETURNING request_count INTO v_count;
  RETURN v_count IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_quota(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_user_data(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user id required'; END IF;
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
  DELETE FROM public.ai_usage_buckets WHERE user_id = p_user_id;
  DELETE FROM public.profiles WHERE user_id = p_user_id;
  DELETE FROM public.user_roles WHERE user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_user_data(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_data(UUID) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_expenses_user_id_fkey' AND conrelid = 'public.recurring_expenses'::regclass) THEN
    ALTER TABLE public.recurring_expenses ADD CONSTRAINT recurring_expenses_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_expense_payments_user_id_fkey' AND conrelid = 'public.recurring_expense_payments'::regclass) THEN
    ALTER TABLE public.recurring_expense_payments ADD CONSTRAINT recurring_expense_payments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;