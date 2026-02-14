
-- Add notify_at timestamp to reminders, debts, goals, car_checks
ALTER TABLE public.reminders ADD COLUMN notify_at timestamptz;
ALTER TABLE public.debts ADD COLUMN notify_at timestamptz;
ALTER TABLE public.goals ADD COLUMN notify_at timestamptz;
ALTER TABLE public.car_checks ADD COLUMN notify_at timestamptz;
