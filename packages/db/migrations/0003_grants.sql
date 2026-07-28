-- 0003_grants.sql — privileges for the application role.
--
-- The role itself is created by Terraform in real environments (and by
-- `npm run db:bootstrap` locally). This migration only grants privileges, so it
-- stays in lockstep with schema changes.
--
-- Guarded on the role existing so a fresh database without the role can still
-- migrate — useful for schema-only CI jobs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgeriq_app') THEN
    RAISE NOTICE 'Role ledgeriq_app not present; skipping grants.';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO ledgeriq_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ledgeriq_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledgeriq_app';

  -- Financial records are never hard-deleted; they are voided with an audit
  -- trail. Withholding DELETE makes that a database guarantee rather than a
  -- convention someone forgets during an incident.
  EXECUTE 'REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM ledgeriq_app';

  -- Governance tables are append-only. The app can write and read them; it
  -- cannot rewrite history.
  EXECUTE 'REVOKE UPDATE, DELETE ON audit_log, data_access_log FROM ledgeriq_app';

  -- Future tables inherit the same posture.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
       || 'GRANT SELECT, INSERT, UPDATE ON TABLES TO ledgeriq_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
       || 'GRANT USAGE, SELECT ON SEQUENCES TO ledgeriq_app';
END $$;
