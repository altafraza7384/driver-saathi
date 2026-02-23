
-- Create marketplace categories table
CREATE TABLE public.marketplace_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'Store',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create marketplace posts table
CREATE TABLE public.marketplace_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.marketplace_categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  post_type TEXT NOT NULL DEFAULT 'text', -- text, image, video
  media_url TEXT,
  contact_phone TEXT,
  contact_link TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.marketplace_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_posts ENABLE ROW LEVEL SECURITY;

-- Categories: everyone can read, only admins can write
CREATE POLICY "Anyone can view active categories"
  ON public.marketplace_categories FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage categories"
  ON public.marketplace_categories FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Posts: everyone can read active posts, only admins can write
CREATE POLICY "Anyone can view active posts"
  ON public.marketplace_posts FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage posts"
  ON public.marketplace_posts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Create storage bucket for marketplace media
INSERT INTO storage.buckets (id, name, public) VALUES ('marketplace', 'marketplace', true);

CREATE POLICY "Anyone can view marketplace files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'marketplace');

CREATE POLICY "Admins can upload marketplace files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'marketplace' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete marketplace files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'marketplace' AND public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_marketplace_posts_updated_at
  BEFORE UPDATE ON public.marketplace_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default categories
INSERT INTO public.marketplace_categories (name, icon, sort_order) VALUES
  ('Insurance Providers', 'Shield', 1),
  ('Insurance Consultants', 'UserCheck', 2),
  ('RTO Works', 'FileCheck', 3),
  ('Vehicle Garages', 'Wrench', 4),
  ('Spare Parts', 'Cog', 5),
  ('Driving Schools', 'GraduationCap', 6);
