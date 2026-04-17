
-- CRITICAL FIX: Stop auto-deleting user transaction data.
-- The previous design auto-deleted transactions older than 30 days, causing
-- production data loss for real users. Unschedule the destructive cron job.

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE command ILIKE '%cleanup-transactions%';
END $$;
