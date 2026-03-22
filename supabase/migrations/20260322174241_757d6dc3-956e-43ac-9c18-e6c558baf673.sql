CREATE POLICY "Users can update own debt payments"
ON public.debt_payments
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);