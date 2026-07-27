-- 0002_rls.sql — Row-level security. The control that matters most.
--
-- Layer 1 of the three-layer isolation strategy in
-- docs/03-engineering/security.md §3. The other two are the typed tenant context
-- in the data-access layer and the adversarial CI suite.
--
-- Two things here are load-bearing and easy to get wrong:
--
--   1. FORCE ROW LEVEL SECURITY. Without it the TABLE OWNER bypasses the policy.
--      Migrations run as the owner, so without FORCE the control silently
--      evaporates in exactly the environment where it's most likely to be tested.
--
--   2. current_setting('app.current_org_id', true) — the `true` means
--      "missing_ok", returning NULL rather than raising when unset. Combined with
--      the NULL-safe comparison below, an unset tenant context yields ZERO rows
--      rather than an error or, far worse, every row. Fails closed.
--
-- NOT handled here, because it CANNOT be: superusers and roles with BYPASSRLS
-- ignore these policies entirely, FORCE notwithstanding. The application must
-- connect as a NOSUPERUSER / NOBYPASSRLS / non-owner role. That precondition is
-- asserted by the tenancy test suite before it runs any isolation case —
-- otherwise every case would pass for the wrong reason.

DO $$
DECLARE
  t TEXT;
  tenant_tables CONSTANT TEXT[] := ARRAY[
    'memberships',
    'api_keys',
    'connections',
    'sync_runs',
    'firm_clients',
    'data_access_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- USING gates reads and the pre-image of writes; WITH CHECK gates the
    -- post-image of INSERT/UPDATE.
    --
    -- WITH CHECK is written out explicitly even though it is currently
    -- REDUNDANT: verified on PG 16.13 that when WITH CHECK is omitted, Postgres
    -- reuses the USING expression as the insert/update check, so a hostile
    -- INSERT is rejected either way. It is stated anyway because the two
    -- expressions are allowed to diverge, and the day someone widens USING for a
    -- read case (say, to expose a shared reference table) an implicit check
    -- would silently widen writes with it. Being explicit costs nothing and
    -- removes that coupling.
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;

-- organizations is tenant-scoped by its own primary key rather than an org_id
-- column, so it gets an equivalent policy keyed on id.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- audit_log carries a nullable org_id (system-level events have none). System
-- rows are deliberately invisible to tenant sessions.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- `users` and `firms` are intentionally NOT tenant-scoped: a user may belong to
-- several orgs and a firm spans many. Access to them is mediated by memberships
-- and firm_clients, which ARE scoped. Reads of these tables must always go
-- through a join against a scoped table — enforced in the repository layer, and
-- covered by the tenancy suite.
