-- LedgerIQ canonical schema
-- PostgreSQL 16+. Requires: pgcrypto, pg_trgm, vector.
-- Design rationale: ../database-schema.md
--
-- Conventions:
--   * Money is NUMERIC(20,4) + an ISO-4217 currency column. Never float.
--   * Every tenant-scoped table has org_id NOT NULL + RLS.
--   * Financial rows are soft-deleted (voided_at), never DELETEd.
--   * occurred_at = economic timing; posted_at = cash timing. They differ and it matters.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE business_model    AS ENUM ('services','subscription','ecommerce','retail','mixed','unknown');
CREATE TYPE source_system     AS ENUM ('quickbooks','xero','plaid','stripe','square','paypal','gusto',
                                       'shopify','amazon_seller','brex','ramp','mercury','hubspot',
                                       'salesforce','manual','csv');
CREATE TYPE source_type       AS ENUM ('accounting','banking','payments','payroll','commerce','crm','spend');
CREATE TYPE connection_status AS ENUM ('active','degraded','reauth_required','error','disconnected');
CREATE TYPE sync_status       AS ENUM ('queued','running','succeeded','partial','failed');
CREATE TYPE txn_direction     AS ENUM ('inflow','outflow');
CREATE TYPE category_source   AS ENUM ('user_rule','source_system','classifier','llm','default');
CREATE TYPE account_type      AS ENUM ('checking','savings','credit_card','loan','line_of_credit',
                                       'investment','payment_processor','other');
CREATE TYPE doc_status        AS ENUM ('draft','open','partial','paid','overdue','void','written_off');
CREATE TYPE member_role       AS ENUM ('owner','admin','finance','viewer','advisor');
CREATE TYPE alert_severity    AS ENUM ('critical','high','medium','info');
CREATE TYPE alert_state       AS ENUM ('pending','sent','acknowledged','dismissed','resolved','suppressed');
CREATE TYPE confidence_level  AS ENUM ('high','medium','low','insufficient_data');
CREATE TYPE resolution_method AS ENUM ('exact_id','deterministic_key','fuzzy','human_confirmed');
CREATE TYPE period_grain      AS ENUM ('day','week','month','quarter','year','trailing_12','custom');

-- ============================================================================
-- IDENTITY, TENANCY, ACCESS
-- ============================================================================

CREATE TABLE organizations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id               UUID,                      -- multi-entity grouping; null = standalone
    name                    TEXT NOT NULL,
    legal_name              TEXT,
    business_model          business_model NOT NULL DEFAULT 'unknown',
    naics_code              TEXT,                      -- benchmarking cohort
    revenue_band            TEXT,                      -- benchmarking cohort
    employee_count          INTEGER,
    country                 CHAR(2) NOT NULL DEFAULT 'US',
    base_currency           CHAR(3) NOT NULL DEFAULT 'USD',
    fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1
                            CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    timezone                TEXT NOT NULL DEFAULT 'America/New_York',
    accounting_basis        TEXT NOT NULL DEFAULT 'accrual' CHECK (accounting_basis IN ('accrual','cash')),
    onboarding_stage        TEXT NOT NULL DEFAULT 'created',
    activated_at            TIMESTAMPTZ,               -- first true insight delivered
    plan_tier               TEXT NOT NULL DEFAULT 'trial',
    settings                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at              TIMESTAMPTZ
);

CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_auth_id  TEXT UNIQUE NOT NULL,            -- WorkOS subject
    email             CITEXT NOT NULL UNIQUE,
    full_name         TEXT,
    mfa_enrolled      BOOLEAN NOT NULL DEFAULT false,
    financial_literacy TEXT NOT NULL DEFAULT 'standard'
                      CHECK (financial_literacy IN ('simple','standard','expert')),
    locale            TEXT NOT NULL DEFAULT 'en-US',
    last_seen_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

CREATE TABLE memberships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        member_role NOT NULL DEFAULT 'viewer',
    -- Column-level restrictions, e.g. hide payroll detail from a non-owner.
    restrictions JSONB NOT NULL DEFAULT '{}',
    invited_by  UUID REFERENCES users(id),
    accepted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ,
    UNIQUE (org_id, user_id)
);

-- Accounting firm / fractional CFO tier.
CREATE TABLE firms (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    plan_tier  TEXT NOT NULL DEFAULT 'firm_starter',
    settings   JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A firm's grant to act on a client org. Checked on every scoped session.
CREATE TABLE firm_clients (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    granted_by    UUID REFERENCES users(id),           -- an owner of the client org
    access_level  TEXT NOT NULL DEFAULT 'advisor',
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at    TIMESTAMPTZ,
    UNIQUE (firm_id, org_id)
);

CREATE TABLE api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,                 -- argon2 of the secret; secret never stored
    key_prefix   TEXT NOT NULL,                        -- displayable identifier
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at   TIMESTAMPTZ
);

-- ============================================================================
-- CONNECTIVITY & INGESTION
-- ============================================================================

CREATE TABLE connections (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                 UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source                 source_system NOT NULL,
    source_kind            source_type NOT NULL,
    external_account_id    TEXT,                       -- provider's id for the connected entity
    display_name           TEXT,
    status                 connection_status NOT NULL DEFAULT 'active',
    status_detail          TEXT,
    -- Sealed with a per-tenant data key from the KMS hierarchy. See security.md §4.
    credentials_encrypted  BYTEA,
    credentials_key_id     TEXT,
    scopes_granted         TEXT[],
    connected_by           UUID REFERENCES users(id),
    last_successful_sync_at TIMESTAMPTZ,               -- drives user-visible data freshness
    next_sync_at           TIMESTAMPTZ,
    sync_cursor            TEXT,                       -- provider delta token
    backfill_completed_at  TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    disconnected_at        TIMESTAMPTZ
);
CREATE INDEX ON connections (org_id, source);
CREATE INDEX ON connections (next_sync_at) WHERE status = 'active';

CREATE TABLE sync_runs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id  UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('full','incremental','webhook','reconcile')),
    status         sync_status NOT NULL DEFAULT 'queued',
    started_at     TIMESTAMPTZ,
    finished_at    TIMESTAMPTZ,
    records_fetched  INTEGER NOT NULL DEFAULT 0,
    records_written  INTEGER NOT NULL DEFAULT 0,
    records_skipped  INTEGER NOT NULL DEFAULT 0,
    error_code     TEXT,
    error_detail   TEXT,
    -- Reconciliation: our totals vs. the source's reported totals. Divergence alerts.
    reconciliation JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON sync_runs (org_id, connection_id, created_at DESC);

-- Immutable archive pointer. Enables replay of normalization without re-fetching.
CREATE TABLE raw_payloads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    sync_run_id   UUID REFERENCES sync_runs(id),
    object_key    TEXT NOT NULL,                       -- S3 key, object-locked
    content_hash  TEXT NOT NULL,
    record_type   TEXT NOT NULL,
    record_count  INTEGER,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON raw_payloads (org_id, connection_id, fetched_at DESC);

-- Entity resolution across sources: "Acme Corp" in QBO == "acme_corp" in Stripe.
CREATE TABLE entity_links (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entity_kind        TEXT NOT NULL CHECK (entity_kind IN ('customer','vendor','account','employee','category')),
    canonical_id       UUID NOT NULL,
    source             source_system NOT NULL,
    source_entity_id   TEXT NOT NULL,
    source_display     TEXT,
    method             resolution_method NOT NULL,
    confidence         NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    needs_review       BOOLEAN NOT NULL DEFAULT false,
    reviewed_by        UUID REFERENCES users(id),
    reviewed_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, source, entity_kind, source_entity_id)
);
CREATE INDEX ON entity_links (org_id, canonical_id);
CREATE INDEX ON entity_links (org_id, needs_review) WHERE needs_review;

-- ============================================================================
-- FINANCIAL CORE
-- ============================================================================

CREATE TABLE categories (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = system taxonomy
    parent_id     UUID REFERENCES categories(id),
    key           TEXT NOT NULL,
    name          TEXT NOT NULL,
    -- Statement classification drives which metrics a category feeds.
    statement     TEXT NOT NULL CHECK (statement IN ('revenue','cogs','opex','other_income',
                                                     'other_expense','asset','liability','equity')),
    is_recurring_candidate BOOLEAN NOT NULL DEFAULT false,
    is_discretionary       BOOLEAN NOT NULL DEFAULT false,  -- used by cost-reduction ranking
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (org_id, key)
);

CREATE TABLE accounts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id      UUID REFERENCES connections(id) ON DELETE SET NULL,
    kind               account_type NOT NULL,
    name               TEXT NOT NULL,
    mask               TEXT,                            -- last 4
    institution_name   TEXT,
    currency           CHAR(3) NOT NULL DEFAULT 'USD',
    current_balance    NUMERIC(20,4),
    available_balance  NUMERIC(20,4),
    credit_limit       NUMERIC(20,4),
    balance_as_of      TIMESTAMPTZ,
    is_operating       BOOLEAN NOT NULL DEFAULT false,  -- counts toward runway/payroll coverage
    include_in_cash    BOOLEAN NOT NULL DEFAULT true,
    source             source_system NOT NULL,
    source_account_id  TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at          TIMESTAMPTZ
);
CREATE INDEX ON accounts (org_id) WHERE closed_at IS NULL;

CREATE TABLE customers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    normalized_name   TEXT NOT NULL,                    -- for fuzzy matching
    email             CITEXT,
    first_seen_at     DATE,
    -- Fitted payment-lag distribution. The single most important field for forecast accuracy.
    -- { mean_days_late, stddev, p50, p90, sample_count, fitted_at }
    payment_behavior  JSONB NOT NULL DEFAULT '{}',
    lifetime_revenue  NUMERIC(20,4) NOT NULL DEFAULT 0,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON customers (org_id, is_active);
CREATE INDEX ON customers USING gin (normalized_name gin_trgm_ops);

CREATE TABLE vendors (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    normalized_name  TEXT NOT NULL,
    default_category_id UUID REFERENCES categories(id),
    is_subscription  BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON vendors USING gin (normalized_name gin_trgm_ops);

CREATE TABLE employees (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    external_ref       TEXT,
    display_name       TEXT,
    employment_type    TEXT CHECK (employment_type IN ('w2_salary','w2_hourly','contractor')),
    annual_base        NUMERIC(20,4),
    -- Fully-loaded multiplier: taxes, benefits, equipment, software. Default 1.30, org-tunable.
    burden_multiplier  NUMERIC(5,3) NOT NULL DEFAULT 1.300,
    department         TEXT,
    started_on         DATE,
    ended_on           DATE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- transactions: the hot table.
-- Partition-ready on occurred_at; enable RANGE partitioning when volume justifies.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
    id                    UUID NOT NULL DEFAULT gen_random_uuid(),
    org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id            UUID REFERENCES accounts(id) ON DELETE SET NULL,

    direction             txn_direction NOT NULL,       -- explicit; never signed amounts
    amount                NUMERIC(20,4) NOT NULL CHECK (amount >= 0),
    currency              CHAR(3) NOT NULL DEFAULT 'USD',
    fx_rate_to_base       NUMERIC(20,10) NOT NULL DEFAULT 1,

    occurred_at           DATE NOT NULL,                -- economic timing (accrual)
    posted_at             DATE,                         -- cash timing (bank settlement)

    description           TEXT,
    merchant_name         TEXT,
    memo                  TEXT,

    category_id           UUID REFERENCES categories(id),
    category_source       category_source NOT NULL DEFAULT 'default',
    category_confidence   NUMERIC(4,3),
    category_locked       BOOLEAN NOT NULL DEFAULT false,  -- user override; never re-categorize

    customer_id           UUID REFERENCES customers(id),
    vendor_id             UUID REFERENCES vendors(id),
    invoice_id            UUID,
    bill_id               UUID,

    -- Deduplication across sources. Aggregations filter is_canonical.
    is_canonical          BOOLEAN NOT NULL DEFAULT true,
    mirrors_transaction_id UUID,
    dedup_method          TEXT,

    -- Internal transfers are excluded from P&L. Missing this inflates both sides.
    is_transfer           BOOLEAN NOT NULL DEFAULT false,
    transfer_pair_id      UUID,

    is_recurring          BOOLEAN NOT NULL DEFAULT false,
    recurring_series_id   UUID,

    -- Lineage
    source                source_system NOT NULL,
    source_txn_id         TEXT,
    raw_payload_id        UUID REFERENCES raw_payloads(id),
    transform_version     TEXT NOT NULL,

    -- Bitemporal: when we learned about it vs. when it happened.
    ingested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    restated_from_id      UUID,
    voided_at             TIMESTAMPTZ,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE UNIQUE INDEX ON transactions (org_id, source, source_txn_id)
    WHERE source_txn_id IS NOT NULL AND voided_at IS NULL;

-- The workhorse index: nearly every analytical query carries this predicate.
CREATE INDEX txn_org_date_analytical ON transactions (org_id, occurred_at DESC)
    WHERE is_canonical AND NOT is_transfer AND voided_at IS NULL;
CREATE INDEX txn_org_category ON transactions (org_id, category_id, occurred_at)
    WHERE is_canonical AND NOT is_transfer AND voided_at IS NULL;
CREATE INDEX txn_org_customer ON transactions (org_id, customer_id, occurred_at)
    WHERE customer_id IS NOT NULL AND is_canonical AND voided_at IS NULL;
CREATE INDEX txn_org_vendor ON transactions (org_id, vendor_id, occurred_at)
    WHERE vendor_id IS NOT NULL AND is_canonical AND voided_at IS NULL;
CREATE INDEX txn_org_cash ON transactions (org_id, posted_at)
    WHERE posted_at IS NOT NULL AND voided_at IS NULL;
-- Dedup candidate search
CREATE INDEX txn_dedup_probe ON transactions (org_id, amount, occurred_at);
CREATE INDEX txn_desc_trgm ON transactions USING gin (description gin_trgm_ops);

CREATE TABLE recurring_series (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    vendor_id      UUID REFERENCES vendors(id),
    category_id    UUID REFERENCES categories(id),
    label          TEXT NOT NULL,
    cadence        TEXT NOT NULL CHECK (cadence IN ('weekly','biweekly','semimonthly','monthly','quarterly','annual')),
    typical_amount NUMERIC(20,4) NOT NULL,
    amount_stddev  NUMERIC(20,4),
    next_expected_on DATE,
    -- Detected escalation, e.g. a SaaS seat count creeping up. Feeds the "leaking money" answer.
    trend_pct_per_year NUMERIC(8,4),
    is_active      BOOLEAN NOT NULL DEFAULT true,
    detected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON recurring_series (org_id, is_active, next_expected_on);

CREATE TABLE invoices (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id             UUID REFERENCES customers(id),
    number                  TEXT,
    status                  doc_status NOT NULL DEFAULT 'open',
    issued_on               DATE NOT NULL,
    due_date                DATE,
    terms_days              INTEGER,
    total                   NUMERIC(20,4) NOT NULL,
    amount_paid             NUMERIC(20,4) NOT NULL DEFAULT 0,
    balance                 NUMERIC(20,4) GENERATED ALWAYS AS (total - amount_paid) STORED,
    currency                CHAR(3) NOT NULL DEFAULT 'USD',
    paid_on                 DATE,
    -- Forecast-engine outputs: derived from the customer's actual behavior, not the due date.
    expected_payment_date   DATE,
    payment_probability     NUMERIC(4,3),
    source                  source_system NOT NULL,
    source_invoice_id       TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at               TIMESTAMPTZ
);
CREATE INDEX ON invoices (org_id, status, due_date) WHERE status IN ('open','partial','overdue');
CREATE INDEX ON invoices (org_id, customer_id, issued_on);
CREATE INDEX ON invoices (org_id, expected_payment_date) WHERE status IN ('open','partial','overdue');

CREATE TABLE invoice_lines (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description  TEXT,
    category_id  UUID REFERENCES categories(id),
    quantity     NUMERIC(20,4),
    unit_amount  NUMERIC(20,4),
    amount       NUMERIC(20,4) NOT NULL,
    project_ref  TEXT                                   -- job costing, when available
);
CREATE INDEX ON invoice_lines (org_id, invoice_id);

CREATE TABLE bills (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    vendor_id         UUID REFERENCES vendors(id),
    number            TEXT,
    status            doc_status NOT NULL DEFAULT 'open',
    issued_on         DATE NOT NULL,
    due_date          DATE,
    total             NUMERIC(20,4) NOT NULL,
    amount_paid       NUMERIC(20,4) NOT NULL DEFAULT 0,
    balance           NUMERIC(20,4) GENERATED ALWAYS AS (total - amount_paid) STORED,
    currency          CHAR(3) NOT NULL DEFAULT 'USD',
    paid_on           DATE,
    is_committed      BOOLEAN NOT NULL DEFAULT true,     -- committed outflow in the forecast
    source            source_system NOT NULL,
    source_bill_id    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at         TIMESTAMPTZ
);
CREATE INDEX ON bills (org_id, status, due_date) WHERE status IN ('open','partial','overdue');

CREATE TABLE bill_lines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bill_id     UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    description TEXT,
    category_id UUID REFERENCES categories(id),
    amount      NUMERIC(20,4) NOT NULL,
    project_ref TEXT
);

CREATE TABLE payroll_runs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pay_date           DATE NOT NULL,
    period_start       DATE,
    period_end         DATE,
    gross_pay          NUMERIC(20,4) NOT NULL,
    employer_taxes     NUMERIC(20,4) NOT NULL DEFAULT 0,
    benefits_cost      NUMERIC(20,4) NOT NULL DEFAULT 0,
    total_cash_impact  NUMERIC(20,4) NOT NULL,           -- what actually leaves the bank
    headcount          INTEGER,
    is_projected       BOOLEAN NOT NULL DEFAULT false,   -- future runs projected from cadence
    source             source_system NOT NULL,
    source_run_id      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON payroll_runs (org_id, pay_date);

-- Daily balance history. Backfilled and maintained; forecasts anchor on this.
CREATE TABLE balances (
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    as_of       DATE NOT NULL,
    balance     NUMERIC(20,4) NOT NULL,
    currency    CHAR(3) NOT NULL DEFAULT 'USD',
    is_estimated BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (account_id, as_of)
);
CREATE INDEX ON balances (org_id, as_of DESC);

-- Journal entries, when the accounting source exposes them. Enables true accrual analysis.
CREATE TABLE journal_entries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    entry_date    DATE NOT NULL,
    memo          TEXT,
    source        source_system NOT NULL,
    source_entry_id TEXT,
    lines         JSONB NOT NULL,                        -- [{account, debit, credit, ...}]
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON journal_entries (org_id, entry_date);

-- ============================================================================
-- INTELLIGENCE LAYER
-- ============================================================================

-- Materialized metric values. engine_version makes historical answers reproducible.
CREATE TABLE metric_snapshots (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    metric_key     TEXT NOT NULL,
    grain          period_grain NOT NULL,
    period_start   DATE NOT NULL,
    period_end     DATE NOT NULL,
    value          NUMERIC(24,6),
    unit           TEXT NOT NULL,
    confidence     confidence_level NOT NULL DEFAULT 'high',
    -- { sourceRecordIds, inputs, dataFreshness } — powers drill-down.
    provenance     JSONB NOT NULL DEFAULT '{}',
    engine_version TEXT NOT NULL,
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    stale          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (org_id, metric_key, grain, period_start, period_end, engine_version)
);
CREATE INDEX ON metric_snapshots (org_id, metric_key, period_start DESC);
CREATE INDEX ON metric_snapshots (org_id, stale) WHERE stale;

CREATE TABLE forecasts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash','revenue','expense')),
    horizon_days   INTEGER NOT NULL DEFAULT 91,
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Daily points: [{ date, p10, p50, p90, committed, receivables, variable, new_revenue }]
    points         JSONB NOT NULL,
    -- Named risk objects, not just a dip in a chart.
    risk_events    JSONB NOT NULL DEFAULT '[]',
    assumptions    JSONB NOT NULL DEFAULT '[]',
    method_version TEXT NOT NULL,
    confidence     confidence_level NOT NULL,
    history_days   INTEGER,                              -- data depth at generation time
    scenario_id    UUID
);
CREATE INDEX ON forecasts (org_id, kind, generated_at DESC);

-- The flywheel table. No user value for a year; strategically the most important table here.
-- Cannot be reconstructed retroactively, so it must be correct from the first forecast.
CREATE TABLE forecast_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    forecast_id     UUID NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
    horizon_days    INTEGER NOT NULL CHECK (horizon_days IN (7,30,90)),
    predicted_p50   NUMERIC(20,4) NOT NULL,
    actual          NUMERIC(20,4) NOT NULL,
    abs_pct_error   NUMERIC(10,6) NOT NULL,
    within_band     BOOLEAN NOT NULL,
    scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (forecast_id, horizon_days)
);
CREATE INDEX ON forecast_scores (org_id, horizon_days, scored_at DESC);

CREATE TABLE health_scores (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    as_of          DATE NOT NULL,
    score          SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
    -- { liquidity, profitability, growth, efficiency, concentration, hygiene } each 0-100
    subscores      JSONB NOT NULL,
    -- The single highest-leverage improvement, with its point delta.
    top_lever      JSONB,
    peer_cohort    TEXT,                                 -- null until cohort has >= 30 orgs
    peer_percentile SMALLINT,
    engine_version TEXT NOT NULL,
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, as_of)
);

CREATE TABLE alert_rules (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_key           TEXT NOT NULL,
    enabled            BOOLEAN NOT NULL DEFAULT true,
    -- Per-org materiality thresholds. Tuned by "not useful" feedback.
    params             JSONB NOT NULL DEFAULT '{}',
    channels           TEXT[] NOT NULL DEFAULT '{in_app,email}',
    min_severity       alert_severity NOT NULL DEFAULT 'medium',
    next_evaluation_at TIMESTAMPTZ,
    UNIQUE (org_id, rule_key)
);
CREATE INDEX ON alert_rules (next_evaluation_at) WHERE enabled;

CREATE TABLE alerts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_key      TEXT NOT NULL,
    severity      alert_severity NOT NULL,
    state         alert_state NOT NULL DEFAULT 'pending',
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    -- Slotted figures + provenance, same contract as AI answers.
    figures       JSONB NOT NULL DEFAULT '{}',
    recommended_action JSONB,
    -- Dedup key: suppresses re-firing the same condition. Core to the false-positive budget.
    dedup_key     TEXT NOT NULL,
    materiality   NUMERIC(20,4),
    triggered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at       TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    dismissed_at  TIMESTAMPTZ,
    feedback      TEXT CHECK (feedback IN ('useful','not_useful','wrong')),
    UNIQUE (org_id, dedup_key)
);
CREATE INDEX ON alerts (org_id, state, triggered_at DESC);

CREATE TABLE scenarios (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by     UUID REFERENCES users(id),
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL,                        -- hire | price_change | lose_customer | ...
    -- Every assumption is a first-class, user-editable object.
    inputs         JSONB NOT NULL,
    assumptions    JSONB NOT NULL DEFAULT '[]',
    results        JSONB,                                -- deltas vs. base + break-even
    base_forecast_id UUID REFERENCES forecasts(id),
    scenario_forecast_id UUID REFERENCES forecasts(id),
    is_saved       BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON scenarios (org_id, created_at DESC);

CREATE TABLE conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id),
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ
);

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    content         TEXT NOT NULL,
    -- Structured answer object per the answer contract (PRD §5.1).
    answer          JSONB,
    trace_id        UUID,
    feedback        SMALLINT CHECK (feedback IN (-1,1)),
    feedback_note   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (org_id, conversation_id, created_at);
CREATE INDEX ON messages (org_id, feedback) WHERE feedback = -1;  -- eval candidate queue

-- Full record of every AI answer: audit, "show the work", eval replay, cost attribution.
CREATE TABLE answer_traces (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    message_id        UUID REFERENCES messages(id) ON DELETE CASCADE,
    question          TEXT NOT NULL,
    classification    JSONB NOT NULL,
    plan              JSONB,
    executed_results  JSONB NOT NULL,                    -- MetricResults with provenance
    narrator_raw      TEXT,                              -- pre-substitution, with slot refs
    verifier_results  JSONB NOT NULL,
    grounding_violations INTEGER NOT NULL DEFAULT 0,
    prompt_version    TEXT NOT NULL,
    model_ids         JSONB NOT NULL,                    -- per-stage model identifiers
    engine_version    TEXT NOT NULL,
    latency_ms        INTEGER,
    tokens_in         INTEGER,
    tokens_out        INTEGER,
    cost_usd          NUMERIC(12,6),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON answer_traces (org_id, created_at DESC);
CREATE INDEX ON answer_traces (prompt_version, created_at DESC);
CREATE INDEX ON answer_traces (org_id) WHERE grounding_violations > 0;

CREATE TABLE reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,                         -- weekly_brief | monthly | board | investor | tax
    period_start  DATE,
    period_end    DATE,
    content       JSONB NOT NULL,
    pdf_object_key TEXT,
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at  TIMESTAMPTZ,
    opened_at     TIMESTAMPTZ,                           -- weekly-brief open rate is a top KPI
    engine_version TEXT NOT NULL
);
CREATE INDEX ON reports (org_id, kind, period_end DESC);

-- Unstructured context only. Financial facts are NEVER retrieved by embedding similarity.
CREATE TABLE documents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,                          -- contract | loan_terms | lease | note
    title        TEXT,
    object_key   TEXT,
    extracted_text TEXT,
    metadata     JSONB NOT NULL DEFAULT '{}',
    uploaded_by  UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE embeddings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    document_id  UUID REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL,
    chunk_text   TEXT NOT NULL,
    embedding    vector(1536) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON embeddings (org_id, document_id);

-- ============================================================================
-- GOVERNANCE — append-only
-- ============================================================================

CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    org_id       UUID REFERENCES organizations(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES users(id),
    actor_type   TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','system','api_key','firm')),
    action       TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id  TEXT,
    before_state JSONB,
    after_state  JSONB,
    ip_address   INET,
    user_agent   TEXT,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (org_id, occurred_at DESC);
CREATE INDEX ON audit_log (actor_user_id, occurred_at DESC);

-- Separate from audit_log: SOC 2 and bank security reviews ask for read access records.
CREATE TABLE data_access_log (
    id            BIGSERIAL PRIMARY KEY,
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id),
    actor_type    TEXT NOT NULL DEFAULT 'user',
    firm_id       UUID REFERENCES firms(id),             -- set when access is via a firm grant
    resource_type TEXT NOT NULL,
    scope         JSONB,                                 -- period, filters, record counts
    accessed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON data_access_log (org_id, accessed_at DESC);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- FORCE matters: without it the table owner bypasses the policy.
-- ============================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'connections','sync_runs','raw_payloads','entity_links','accounts','customers','vendors',
    'employees','transactions','recurring_series','invoices','invoice_lines','bills','bill_lines',
    'payroll_runs','balances','journal_entries','metric_snapshots','forecasts','forecast_scores',
    'health_scores','alert_rules','alerts','scenarios','conversations','messages','answer_traces',
    'reports','documents','embeddings','data_access_log','memberships','api_keys'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (org_id = current_setting(''app.current_org_id'', true)::uuid)',
      t);
  END LOOP;
END $$;

-- Append-only enforcement for governance tables: app role gets INSERT and SELECT only.
-- (Role grants are managed in Terraform; noted here so the intent lives with the schema.)
--   REVOKE UPDATE, DELETE ON audit_log, data_access_log FROM app_role;

-- ---------------------------------------------------------------------------
-- CRITICAL: RLS is bypassed by superusers and by roles with BYPASSRLS,
-- regardless of FORCE ROW LEVEL SECURITY. Verified against PG 16.13:
-- a superuser session with app.current_org_id set to one org still saw all orgs.
--
-- Therefore the application MUST connect as a role that is:
--     NOSUPERUSER, NOBYPASSRLS, and NOT the owner of these tables.
-- Enforce this in Terraform and assert it in the tenancy CI suite. Connecting
-- the app as the migration/owner role silently disables every policy above.
--
-- Verified behavior of the policy set (PG 16.13, role app_role):
--   * unscoped SELECT with tenant context  -> only that tenant's rows
--   * SELECT explicitly targeting another org_id -> 0 rows
--   * no app.current_org_id set            -> 0 rows (fails closed)
-- ---------------------------------------------------------------------------
--   CREATE ROLE app_role LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- ============================================================================
-- OPERATIONAL VIEWS
-- ============================================================================

-- Canonical, non-transfer, non-voided transactions. The default base for analytical queries;
-- using this view instead of the raw table prevents the most common aggregation bug.
CREATE VIEW v_transactions_analytical AS
SELECT * FROM transactions
WHERE is_canonical AND NOT is_transfer AND voided_at IS NULL;

-- Per-source data freshness, rendered in the UI on every surface.
CREATE VIEW v_data_freshness AS
SELECT org_id,
       source_kind,
       max(last_successful_sync_at) AS last_sync_at,
       bool_or(status <> 'active')  AS has_degraded_connection
FROM connections
WHERE disconnected_at IS NULL
GROUP BY org_id, source_kind;
