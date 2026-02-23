-- Create FCM tokens table for storing device tokens
CREATE TABLE IF NOT EXISTS fcm_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  device_info JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_id ON fcm_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_token ON fcm_tokens(token);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_created_at ON fcm_tokens(created_at DESC);

-- Enable Row Level Security
ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own FCM tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Users can insert their own FCM tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Users can update their own FCM tokens" ON fcm_tokens;
DROP POLICY IF EXISTS "Users can delete their own FCM tokens" ON fcm_tokens;

-- Create RLS policies
-- Users can view their own tokens
CREATE POLICY "Users can view their own FCM tokens"
  ON fcm_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own tokens
CREATE POLICY "Users can insert their own FCM tokens"
  ON fcm_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own tokens
CREATE POLICY "Users can update their own FCM tokens"
  ON fcm_tokens
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own tokens
CREATE POLICY "Users can delete their own FCM tokens"
  ON fcm_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_fcm_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_fcm_tokens_updated_at_trigger ON fcm_tokens;
CREATE TRIGGER update_fcm_tokens_updated_at_trigger
  BEFORE UPDATE ON fcm_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_fcm_tokens_updated_at();

-- Add comments for documentation
COMMENT ON TABLE fcm_tokens IS 'Stores Firebase Cloud Messaging tokens for push notifications';
COMMENT ON COLUMN fcm_tokens.user_id IS 'Reference to the user who owns this token';
COMMENT ON COLUMN fcm_tokens.token IS 'FCM device token (unique)';
COMMENT ON COLUMN fcm_tokens.device_info IS 'JSON object containing device information (platform, app version, etc.)';
COMMENT ON COLUMN fcm_tokens.created_at IS 'Timestamp when the token was first created';
COMMENT ON COLUMN fcm_tokens.updated_at IS 'Timestamp when the token was last updated';
