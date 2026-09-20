-- Migration 047: Add sender_type column to messages table if not exists
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_type TEXT DEFAULT 'customer';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_from_customer BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'inbound';
