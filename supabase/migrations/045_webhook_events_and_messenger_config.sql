-- ============================================================
-- 045_webhook_events_and_messenger_config.sql
-- 1. Create webhook_events table for raw Meta payload logging
-- 2. Add account_id and app_secret to messenger_config table
-- ============================================================

-- 1. WEBHOOK_EVENTS table for logging raw inbound webhook payloads
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'messenger',
  event_type TEXT,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'received',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_account_id ON webhook_events(account_id);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access on webhook_events" ON webhook_events;
CREATE POLICY "Service role full access on webhook_events" ON webhook_events FOR ALL USING (true);

-- 2. Ensure MESSENGER_CONFIG table has account_id and app_secret
ALTER TABLE messenger_config ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE messenger_config ADD COLUMN IF NOT EXISTS app_secret TEXT;

CREATE INDEX IF NOT EXISTS idx_messenger_config_account_id ON messenger_config(account_id);
CREATE INDEX IF NOT EXISTS idx_messenger_config_page_id ON messenger_config(page_id);
