-- 0005_canonical.sql — the canonical financial model.
--
-- Everything before this migration was plumbing: getting bytes out of a provider
-- and into durable storage. This is where those bytes become a queryable, source-
-- agnostic representation of a business's finances — the layer the metric engine
-- computes over and, per architecture.md §2, the layer that is actually the
-- product's defensible position.
--
-- Design notes that matter downstream:
--   * direction + positive amount, never signed. Sign conventions differ between
--     providers and signed columns invite aggregation errors at every call site.
--   * is_canonical / is_transfer exist so that "the correct default query" is a
--     single indexed predicate rather than something each caller must remember.
--   * occurred_at vs posted_at: economic timing vs cash settlement. Cash
--     forecasting reads one, accrual P&L reads the other. Conflating them is an
--     invisible bug.

CREATE TYPE txn_direction   AS ENUM ('inflow','outflow');
CREATE TYPE category_source AS ENUM ('user_rule','source_system','classifier','llm','default');
CREATE TYPE account_type    AS ENUM ('checking','savings','credit_card','loan','line_of_credit',
                                     'investment','payment_processor','other');
CREATE TYPE doc_status      AS ENUM ('draft','open','partial','paid','overdue','void','written_off');

-- Canonical statement classification. This is what the chart of accounts maps
-- INTO — the vocabulary the metric engine speaks, independent of what any
-- particular business named their accounts.
CREATE TYPE statement_class AS ENUM ('revenue','cogs','opex','payroll','other_income',
                                     'other_expense','asset','liability','equity');

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = system taxonomy
    parent_id   UUID REFERENCES categories(id),
    key         TEXT NOT NULL,
    name        TEXT NOT NULL,
    statement   statement_class NOT NULL,
    is_discretionary BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (org_id, key)
);

-- The chart of accounts as the source system has it, mapped to our vocabulary.
-- The mapping is the single hardest part of onboarding (onboarding.md §6) and is
-- kept as data, with its confidence, rather than baked into code.
CREATE TABLE ledger_accounts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source            source_system NOT NULL,
    source_account_id TEXT NOT NULL,
    name              TEXT NOT NULL,
    full_name         TEXT,
    account_type      TEXT,
    account_subtype   TEXT,
    statement         statement_class,
    mapping_confidence NUMERIC(4,3),
    needs_review      BOOLEAN NOT NULL DEFAULT false,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, source, source_account_id)
);
CREATE INDEX ledger_accounts_review_idx ON ledger_accounts (org_id) WHERE needs_review;

CREATE TABLE accounts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id     UUID REFERENCES connections(id) ON DELETE SET NULL,
    kind              account_type NOT NULL,
    name              TEXT NOT NULL,
    mask              TEXT,
    institution_name  TEXT,
    currency          CHAR(3) NOT NULL DEFAULT 'USD',
    current_balance   NUMERIC(20,4),
    balance_as_of     TIMESTAMPTZ,
    -- Counts toward runway and payroll coverage. Not every account should.
    is_operating      BOOLEAN NOT NULL DEFAULT true,
    include_in_cash   BOOLEAN NOT NULL DEFAULT true,
    source            source_system NOT NULL,
    source_account_id TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at         TIMESTAMPTZ
);

CREATE TABLE customers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    normalized_name  TEXT NOT NULL,
    email            TEXT,
    -- Fitted payment-lag distribution: the single highest-leverage input to
    -- forecast accuracy (ai-cfo-engine.md §6). Real customers pay at net-52 on
    -- net-30 terms, and projecting from the due date instead of from observed
    -- behaviour is what makes naive forecasts useless.
    payment_behavior JSONB NOT NULL DEFAULT '{}',
    source           source_system NOT NULL,
    source_customer_id TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, source, source_customer_id)
);

CREATE TABLE vendors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    is_subscription BOOLEAN NOT NULL DEFAULT false,
    source          source_system NOT NULL,
    source_vendor_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, source, source_vendor_id)
);

CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id          UUID REFERENCES accounts(id) ON DELETE SET NULL,
    ledger_account_id   UUID REFERENCES ledger_accounts(id) ON DELETE SET NULL,

    direction           txn_direction NOT NULL,
    amount              NUMERIC(20,4) NOT NULL CHECK (amount >= 0),
    currency            CHAR(3) NOT NULL DEFAULT 'USD',

    occurred_at         DATE NOT NULL,   -- economic timing (accrual)
    posted_at           DATE,            -- cash settlement

    description         TEXT,
    merchant_name       TEXT,

    category_id         UUID REFERENCES categories(id),
    statement           statement_class,
    category_source     category_source NOT NULL DEFAULT 'default',
    category_confidence NUMERIC(4,3),

    customer_id         UUID REFERENCES customers(id),
    vendor_id           UUID REFERENCES vendors(id),
    invoice_id          UUID,

    -- Dedup across sources. Aggregations filter on is_canonical.
    is_canonical        BOOLEAN NOT NULL DEFAULT true,
    mirrors_transaction_id UUID,
    -- Internal movement. Excluded from P&L; missing this inflates both sides.
    is_transfer         BOOLEAN NOT NULL DEFAULT false,
    transfer_pair_id    UUID,

    source              source_system NOT NULL,
    source_txn_id       TEXT,
    source_record_type  TEXT,
    raw_payload_id      UUID REFERENCES raw_payloads(id),
    transform_version   TEXT NOT NULL,

    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX transactions_source_key
    ON transactions (org_id, source, source_record_type, source_txn_id)
    WHERE source_txn_id IS NOT NULL AND voided_at IS NULL;

-- The workhorse: nearly every analytical query carries exactly this predicate.
CREATE INDEX transactions_analytical_idx
    ON transactions (org_id, occurred_at DESC)
    WHERE is_canonical AND NOT is_transfer AND voided_at IS NULL;
CREATE INDEX transactions_statement_idx
    ON transactions (org_id, statement, occurred_at)
    WHERE is_canonical AND NOT is_transfer AND voided_at IS NULL;
CREATE INDEX transactions_customer_idx
    ON transactions (org_id, customer_id, occurred_at) WHERE customer_id IS NOT NULL;
CREATE INDEX transactions_cash_idx ON transactions (org_id, posted_at) WHERE posted_at IS NOT NULL;

CREATE TABLE invoices (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id           UUID REFERENCES customers(id),
    number                TEXT,
    status                doc_status NOT NULL DEFAULT 'open',
    issued_on             DATE NOT NULL,
    due_date              DATE,
    terms_days            INTEGER,
    total                 NUMERIC(20,4) NOT NULL,
    amount_paid           NUMERIC(20,4) NOT NULL DEFAULT 0,
    balance               NUMERIC(20,4) GENERATED ALWAYS AS (total - amount_paid) STORED,
    currency              CHAR(3) NOT NULL DEFAULT 'USD',
    paid_on               DATE,
    -- Derived from the customer's observed behaviour, NOT from due_date.
    expected_payment_date DATE,
    payment_probability   NUMERIC(4,3),
    source                source_system NOT NULL,
    source_invoice_id     TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    voided_at             TIMESTAMPTZ,
    UNIQUE (org_id, source, source_invoice_id)
);
CREATE INDEX invoices_open_idx ON invoices (org_id, status, due_date)
    WHERE status IN ('open','partial','overdue');

CREATE TABLE payroll_runs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pay_date          DATE NOT NULL,
    gross_pay         NUMERIC(20,4) NOT NULL,
    employer_taxes    NUMERIC(20,4) NOT NULL DEFAULT 0,
    benefits_cost     NUMERIC(20,4) NOT NULL DEFAULT 0,
    total_cash_impact NUMERIC(20,4) NOT NULL,
    headcount         INTEGER,
    -- Future runs projected from observed cadence. The forecast treats projected
    -- payroll as a committed outflow, which is what makes payroll-risk detection
    -- possible before a payroll provider is even connected.
    is_projected      BOOLEAN NOT NULL DEFAULT false,
    source            source_system NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payroll_runs_date_idx ON payroll_runs (org_id, pay_date);

CREATE TABLE balances (
    org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    as_of      DATE NOT NULL,
    balance    NUMERIC(20,4) NOT NULL,
    PRIMARY KEY (account_id, as_of)
);
CREATE INDEX balances_org_idx ON balances (org_id, as_of DESC);

-- Materialised metric values. engine_version is what makes an answer generated
-- today reproducible after the metric definition changes.
CREATE TABLE metric_snapshots (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    metric_key     TEXT NOT NULL,
    grain          TEXT NOT NULL,
    period_start   DATE NOT NULL,
    period_end     DATE NOT NULL,
    value          NUMERIC(24,6),
    unit           TEXT NOT NULL,
    confidence     TEXT NOT NULL DEFAULT 'high',
    provenance     JSONB NOT NULL DEFAULT '{}',
    engine_version TEXT NOT NULL,
    computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, metric_key, grain, period_start, period_end, engine_version)
);
CREATE INDEX metric_snapshots_lookup ON metric_snapshots (org_id, metric_key, period_start DESC);

CREATE TABLE forecasts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL DEFAULT 'cash',
    horizon_days   INTEGER NOT NULL DEFAULT 91,
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    points         JSONB NOT NULL,
    risk_events    JSONB NOT NULL DEFAULT '[]',
    assumptions    JSONB NOT NULL DEFAULT '[]',
    method_version TEXT NOT NULL,
    confidence     TEXT NOT NULL,
    history_days   INTEGER
);
CREATE INDEX forecasts_latest_idx ON forecasts (org_id, kind, generated_at DESC);

-- RLS, same shape as everywhere else. See 0002 for why FORCE and the NULL-safe
-- comparison both matter.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_accounts','accounts','customers','vendors','transactions',
                           'invoices','payroll_runs','balances','metric_snapshots','forecasts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;

-- categories carries system rows (org_id IS NULL) alongside tenant rows, so its
-- policy admits the shared taxonomy as well as the tenant's own.
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categories
  USING (org_id IS NULL OR org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgeriq_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ledgeriq_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledgeriq_app';
    EXECUTE 'REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM ledgeriq_app';
    EXECUTE 'REVOKE UPDATE ON audit_log, data_access_log, raw_payloads FROM ledgeriq_app';
  END IF;
END $$;

-- System category taxonomy: the vocabulary every business's chart of accounts
-- maps into.
INSERT INTO categories (org_id, key, name, statement, is_discretionary) VALUES
  (NULL, 'revenue.services',    'Services Revenue',      'revenue',       false),
  (NULL, 'revenue.product',     'Product Revenue',       'revenue',       false),
  (NULL, 'revenue.other',       'Other Revenue',         'revenue',       false),
  (NULL, 'cogs.subcontractors', 'Subcontractors',        'cogs',          false),
  (NULL, 'cogs.materials',      'Materials',             'cogs',          false),
  (NULL, 'cogs.hosting',        'Hosting & Infrastructure','cogs',        false),
  (NULL, 'payroll.wages',       'Wages & Salaries',      'payroll',       false),
  (NULL, 'payroll.taxes',       'Payroll Taxes',         'payroll',       false),
  (NULL, 'payroll.benefits',    'Benefits',              'payroll',       false),
  (NULL, 'opex.rent',           'Rent',                  'opex',          false),
  (NULL, 'opex.software',       'Software & Subscriptions','opex',        true),
  (NULL, 'opex.marketing',      'Marketing',             'opex',          true),
  (NULL, 'opex.travel',         'Travel & Entertainment','opex',          true),
  (NULL, 'opex.professional',   'Professional Fees',     'opex',          false),
  (NULL, 'opex.insurance',      'Insurance',             'opex',          false),
  (NULL, 'opex.utilities',      'Utilities',             'opex',          false),
  (NULL, 'opex.office',         'Office & Supplies',     'opex',          true),
  (NULL, 'opex.other',          'Other Operating',       'opex',          true),
  (NULL, 'other.taxes',         'Income Taxes',          'other_expense', false),
  (NULL, 'other.interest',      'Interest',              'other_expense', false),
  (NULL, 'uncategorized',       'Uncategorized',         'opex',          false);
