-- Migration 048: Ensure account_id column exists on messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS account_id UUID;
