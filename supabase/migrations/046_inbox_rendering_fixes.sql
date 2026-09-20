-- Migration 046: Fixes for Inbox Message Rendering and 24-Hour Timer
-- Adds missing columns for explicit message directional flags and conversation customer message timestamps.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_from_customer BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'inbound';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ;

-- Backfill existing messages where sender_type = 'customer' or content matches incoming messages
UPDATE messages 
SET is_from_customer = true, direction = 'inbound', sender_type = 'customer'
WHERE sender_type = 'customer' OR is_from_customer = true;

-- Backfill existing messages where sender_type IN ('agent', 'bot')
UPDATE messages 
SET is_from_customer = false, direction = 'outbound'
WHERE sender_type IN ('agent', 'bot') AND is_from_customer IS NOT TRUE;

-- Backfill conversations last_customer_message_at from last_inbound_at or last_message_at if null
UPDATE conversations 
SET last_customer_message_at = COALESCE(last_inbound_at, last_message_at)
WHERE last_customer_message_at IS NULL AND last_inbound_at IS NOT NULL;

