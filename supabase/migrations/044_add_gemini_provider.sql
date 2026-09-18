-- ============================================================
-- 044_add_gemini_provider.sql
-- Update ai_configs and ai_usage_log table check constraints
-- to allow 'gemini' as an AI Provider
-- ============================================================

DO $$ 
DECLARE
  conf_constraint_name text;
  usage_constraint_name text;
BEGIN
  -- Find the constraint name for ai_configs.provider
  SELECT conname INTO conf_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'ai_configs'::regclass 
    AND contype = 'c' 
    AND pg_get_constraintdef(oid) LIKE '%provider%';

  IF conf_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE ai_configs DROP CONSTRAINT ' || conf_constraint_name;
  END IF;

  -- Add the new constraint allowing gemini for ai_configs
  ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check CHECK (provider IN ('openai', 'anthropic', 'gemini'));

  -- Find the constraint name for ai_usage_log.provider
  SELECT conname INTO usage_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'ai_usage_log'::regclass 
    AND contype = 'c' 
    AND pg_get_constraintdef(oid) LIKE '%provider%';

  IF usage_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE ai_usage_log DROP CONSTRAINT ' || usage_constraint_name;
  END IF;

  -- Add the new constraint allowing gemini for ai_usage_log
  ALTER TABLE ai_usage_log ADD CONSTRAINT ai_usage_log_provider_check CHECK (provider IN ('openai', 'anthropic', 'gemini'));
END $$;
