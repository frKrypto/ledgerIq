-- 0001_core.sql — Sprint 1 core schema.
--
-- Scope is deliberately the identity/tenancy/connectivity spine only. Financial
-- tables (transactions, invoices, bills, metrics) arrive in sprints 3-5. The full
-- target schema is documented at docs/03-engineering/schema/schema.sql.
--
-- Conventions (docs/03-engineering/database-schema.md §1):
--   * Money is NUMERIC(20,4) + explicit currency. Never float.
--   * Every tenant-scoped table has org_id NOT NULL and gets RLS in 0002.
--   * Financial rows are soft-deleted, never DELETEd.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── enums ────────────────────────────────────────────────────────────────────

CREATE TYPE business_model    AS ENUM ('services','subscription','ecommerce','retail','mixed','unknown');
CREATE TYPE member_role       AS ENUM ('owner','admin','finance','viewer','advisor');
CREATE TYPE source_system     AS ENUM ('quickbooks','xero','plaid','stripe','square','paypal','gusto',
                                       'shopify','amazon_seller','brex','ramp','mercury','hubspot',
                                       'salesforce','manual','csv');
CREATE TYPE source_type       AS ENUM ('accounting','banking','payments','payroll','commerce','crm','spend');
CREATE TYPE connection_status AS ENUM ('active','degraded','reauth_required','error','disconnected');
CREATE TYPE sync_status       AS ENUM ('queued','running','succeeded','partial','failed');

-- ── identity & tenancy ───────────────────────────────────────────────────────

CREATE TABLE organizations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id               UUID,
    name                    TEXT NOT NULL,
    legal_name              TEXT,
    business_model          business_model NOT NULL DEFAULT 'unknown',
    naics_code              TEXT,
    revenue_band            TEXT,
    employee_count          INTEGER,
    country                 CHAR(2) NOT NULL DEFAULT 'US',
    base_currency           CHAR(3) NOT NULL DEFAULT 'USD',
    -- Not every business is calendar-year. Getting this wrong makes every annual
    -- metric wrong, silently.
    fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1
                            CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    timezone                TEXT NOT NULL DEFAULT 'America/New_York',
    accounting_basis        TEXT NOT NULL DEFAULT 'accrual'
                            CHECK (accounting_basis IN ('accrual','cash')),
    onboarding_stage        TEXT NOT NULL DEFAULT 'created',
    activated_at            TIMESTAMPTZ,
    plan_tier               TEXT NOT NULL DEFAULT 'trial',
    settings                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ
);

CREATE TABLE users (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_auth_id   TEXT NOT NULL UNIQUE,
    email              CITEXT NOT NULL UNIQUE,
    full_name          TEXT,
    mfa_enrolled       BOOLEAN NOT NULL DEFAULT false,
    financial_literacy TEXT NOT NULL DEFAULT 'standard'
                       CHECK (financial_literacy IN ('simple','standard','expert')),
    locale             TEXT NOT NULL DEFAULT 'en-US',
    last_seen_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);

CREATE TABLE memberships (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         member_role NOT NULL DEFAULT 'viewer',
    -- Column-level suppression, e.g. hide individual salaries from an ops manager
    -- while keeping payroll totals visible.
    restrictions JSONB NOT NULL DEFAULT '{}',
    invited_by   UUID REFERENCES users(id),
    accepted_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ,
    UNIQUE (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id) WHERE revoked_at IS NULL;

CREATE TABLE firms (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    plan_tier  TEXT NOT NULL DEFAULT 'firm_starter',
    settings   JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A firm's grant to act on a client org. Validated on every scoped session; a firm
-- user never gets a widened tenant scope, only a series of single-org scopes.
CREATE TABLE firm_clients (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id      UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    granted_by   UUID REFERENCES users(id),
    access_level TEXT NOT NULL DEFAULT 'advisor',
    granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ,
    UNIQUE (firm_id, org_id)
);
CREATE INDEX firm_clients_firm_idx ON firm_clients (firm_id) WHERE revoked_at IS NULL;

CREATE TABLE api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    -- argon2 of the secret. The secret itself is shown once and never stored.
    key_hash     TEXT NOT NULL UNIQUE,
    key_prefix   TEXT NOT NULL,
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ
);

-- ── connectivity ─────────────────────────────────────────────────────────────

CREATE TABLE connections (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source                  source_system NOT NULL,
    source_kind             source_type NOT NULL,
    external_account_id     TEXT,
    display_name            TEXT,
    -- Product-visible state, not an internal error code. The UI renders this.
    status                  connection_status NOT NULL DEFAULT 'active',
    status_detail           TEXT,
    -- Sealed with a per-tenant data key from the KMS hierarchy (security.md §4).
    -- A dumped database yields no usable provider tokens.
    --
    -- TEXT holding base64 rather than BYTEA: it round-trips identically through
    -- every driver and pooler, and it is greppable in tests — which matters,
    -- because the test that proves no plaintext token reaches the database scans
    -- this column directly. The ~33% size overhead is irrelevant for credentials.
    credentials_encrypted   TEXT,
    credentials_key_id      TEXT,
    scopes_granted          TEXT[],
    connected_by            UUID REFERENCES users(id),
    last_successful_sync_at TIMESTAMPTZ,
    next_sync_at            TIMESTAMPTZ,
    sync_cursor             TEXT,
    backfill_completed_at   TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    disconnected_at         TIMESTAMPTZ
);
CREATE INDEX connections_org_idx ON connections (org_id, source);
CREATE INDEX connections_due_idx ON connections (next_sync_at) WHERE status = 'active';

CREATE TABLE sync_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id   UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('full','incremental','webhook','reconcile')),
    status          sync_status NOT NULL DEFAULT 'queued',
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    records_fetched INTEGER NOT NULL DEFAULT 0,
    records_written INTEGER NOT NULL DEFAULT 0,
    records_skipped INTEGER NOT NULL DEFAULT 0,
    error_code      TEXT,
    error_detail    TEXT,
    -- Our totals vs. the source's reported totals. Divergence alerts before a
    -- user notices; this is what catches silent connector breakage.
    reconciliation  JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sync_runs_recent_idx ON sync_runs (org_id, connection_id, created_at DESC);

-- ── governance (append-only) ─────────────────────────────────────────────────

CREATE TABLE audit_log (
    id            BIGSERIAL PRIMARY KEY,
    org_id        UUID REFERENCES organizations(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES users(id),
    actor_type    TEXT NOT NULL DEFAULT 'user'
                  CHECK (actor_type IN ('user','system','api_key','firm')),
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT,
    before_state  JSONB,
    after_state   JSONB,
    ip_address    INET,
    user_agent    TEXT,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (org_id, occurred_at DESC);

-- Separate from audit_log on purpose: SOC 2 and bank security reviews ask for
-- records of who *read* financial data, not just who changed it.
CREATE TABLE data_access_log (
    id            BIGSERIAL PRIMARY KEY,
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id),
    actor_type    TEXT NOT NULL DEFAULT 'user',
    firm_id       UUID REFERENCES firms(id),
    resource_type TEXT NOT NULL,
    scope         JSONB,
    accessed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX data_access_log_org_idx ON data_access_log (org_id, accessed_at DESC);
