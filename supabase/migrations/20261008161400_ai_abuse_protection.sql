-- Production AI abuse/cost protection
-- Atomic per-user hourly quotas for AI edge functions.

CREATE TABLE IF NOT EXISTS public.ai_usage_buckets (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, feature, bucket_start)
);

ALTER TABLE public.ai_usage_buckets ENABLE ROW LEVEL SECURITY;

-- No client policies: only trusted server-side service-role calls may use this table.
REVOKE ALL ON TABLE public.ai_usage_buckets FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_user_id UUID,
  p_feature TEXT,
  p_limit INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  DO UPDATE
    SET request_count = public.ai_usage_buckets.request_count + 1
    WHERE public.ai_usage_buckets.request_count < p_limit
  RETURNING request_count INTO v_count;

  RETURN v_count IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(UUID, TEXT, INTEGER) TO service_role;

-- Keep the small quota table tidy.
CREATE INDEX IF NOT EXISTS ai_usage_buckets_bucket_start_idx
  ON public.ai_usage_buckets (bucket_start);
