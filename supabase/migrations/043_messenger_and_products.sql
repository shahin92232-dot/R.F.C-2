-- ============================================================
-- 043_messenger_and_products.sql
-- Additive migration: Converts WhatsApp CRM schema concepts to
-- Messenger CRM concepts & adds Products support for AI agents.
-- ============================================================

-- 1. CONTACTS: Make phone optional and add Messenger PSID (Page-Scoped ID)
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS psid TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_psid ON contacts(psid);

-- 2. CONVERSATIONS: Add last_inbound_at timestamp to track the Meta 24-hour messaging window
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS psid TEXT;

-- 3. MESSENGER_CONFIG: Table replacing/complementing whatsapp_config
CREATE TABLE IF NOT EXISTS messenger_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_name TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id),
  UNIQUE(page_id)
);

ALTER TABLE messenger_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own messenger config" ON messenger_config;
CREATE POLICY "Users can manage own messenger config" ON messenger_config FOR ALL USING (auth.uid() = user_id);

-- 4. SAVED_REPLIES / QUICK_REPLIES table (Messenger replaces WhatsApp pre-approved Meta templates with Quick/Saved Replies)
CREATE TABLE IF NOT EXISTS saved_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  shortcut TEXT,
  content_text TEXT NOT NULL,
  media_url TEXT,
  buttons JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE saved_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own saved replies" ON saved_replies;
CREATE POLICY "Users can manage own saved replies" ON saved_replies FOR ALL USING (auth.uid() = user_id);

-- 5. PRODUCTS table for AI agents & CRM product management
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  currency TEXT NOT NULL DEFAULT 'USD',
  image_url TEXT,
  sku TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own products" ON products;
CREATE POLICY "Users can manage own products" ON products FOR ALL USING (auth.uid() = user_id);

-- 6. TRIGGERS FOR UPDATED_AT
DROP TRIGGER IF EXISTS set_updated_at ON messenger_config;
DROP TRIGGER IF EXISTS set_updated_at ON saved_replies;
DROP TRIGGER IF EXISTS set_updated_at ON products;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON messenger_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON saved_replies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
