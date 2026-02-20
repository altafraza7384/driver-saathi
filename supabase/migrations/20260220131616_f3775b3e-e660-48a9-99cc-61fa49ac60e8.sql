
-- Add foreign key constraints for tables missing them
ALTER TABLE public.health_logs 
  ADD CONSTRAINT health_logs_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.car_checks 
  ADD CONSTRAINT car_checks_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.reminders 
  ADD CONSTRAINT reminders_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.notes 
  ADD CONSTRAINT notes_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.emergency_contacts 
  ADD CONSTRAINT emergency_contacts_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.chat_messages 
  ADD CONSTRAINT chat_messages_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.push_subscriptions 
  ADD CONSTRAINT push_subscriptions_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.sent_notifications 
  ADD CONSTRAINT sent_notifications_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
