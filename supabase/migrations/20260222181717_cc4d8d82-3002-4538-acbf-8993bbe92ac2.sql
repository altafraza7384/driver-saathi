
-- Create car_documents table for vehicle document tracking
CREATE TABLE public.car_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  document_name TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  notify_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.car_documents ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own car documents" ON public.car_documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own car documents" ON public.car_documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own car documents" ON public.car_documents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own car documents" ON public.car_documents FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_car_documents_updated_at
BEFORE UPDATE ON public.car_documents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
