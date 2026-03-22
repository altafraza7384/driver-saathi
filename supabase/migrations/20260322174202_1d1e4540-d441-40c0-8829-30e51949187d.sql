-- Drop the permissive deny policies and replace with restrictive ones
DROP POLICY IF EXISTS "Deny insert on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Deny update on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Deny delete on user_roles" ON public.user_roles;

-- RESTRICTIVE policies: these block access regardless of other permissive policies
CREATE POLICY "Block insert on user_roles"
ON public.user_roles
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "Block update on user_roles"
ON public.user_roles
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (false);

CREATE POLICY "Block delete on user_roles"
ON public.user_roles
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (false);