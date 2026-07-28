-- 0004_ingestion.sql — raw payload archive and resumable sync checkpoints.
--
-- Two ideas here carry real weight:
--
-- 1. raw_payloads is an IMMUTABLE archive of exactly what the provider returned.
--    When a normalization bug is found six months from now, we replay from this
--    rather than re-fetching from a provider that may no longer return the same
--    data (QuickBooks does not guarantee historical stability, and deleted
--    records simply vanish). It is also the deepest recovery layer: given raw
--    payloads, the entire canonical store can be rebuilt.
--
-- 2. sync_checkpoints make backfill resumable. A 24-month QuickBooks backfill
--    behind a rate-limited API takes many minutes and WILL be interrupted —
--    deploys, OOM, provider 500s. Restarting from zero each time is not a
--    recovery strategy; it's how a backfill never completes.

CREATE TABLE raw_payloads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    sync_run_id   UUID REFERENCES sync_runs(id) ON DELETE SET NULL,

    -- Pointer into object storage (S3 with Object Lock in production).
    object_key    TEXT NOT NULL,
    -- sha256 of the stored bytes. Detects silent corruption and makes replay
    -- verifiable; also dedupes identical pages fetched twice after a retry.
    content_hash  TEXT NOT NULL,
    byte_size     INTEGER NOT NULL,

    record_type   TEXT NOT NULL,          -- 'Invoice', 'Account', 'Purchase', ...
    record_count  INTEGER NOT NULL DEFAULT 0,
    -- Provider-side window this page covers, for replay targeting.
    page_index    INTEGER,
    window_start  DATE,
    window_end    DATE,

    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX raw_payloads_lookup_idx
    ON raw_payloads (org_id, connection_id, record_type, fetched_at DESC);
-- A retried page produces identical bytes; storing it twice wastes space and
-- makes replay counts wrong.
CREATE UNIQUE INDEX raw_payloads_dedup_idx
    ON raw_payloads (connection_id, record_type, content_hash);

-- ─────────────────────────────────────────────────────────────────────────────
-- Resumable sync progress.
--
-- One row per (connection, record_type). `cursor` holds whatever the provider
-- needs to continue — for QuickBooks a start position plus the query window; for
-- Plaid a cursor token. Deliberately opaque JSONB so adapters own their own
-- resume semantics rather than the schema guessing at them.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sync_checkpoints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    connection_id  UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    record_type    TEXT NOT NULL,
    phase          TEXT NOT NULL DEFAULT 'backfill'
                   CHECK (phase IN ('backfill','incremental','complete')),
    cursor         JSONB NOT NULL DEFAULT '{}',
    records_seen   INTEGER NOT NULL DEFAULT 0,
    -- Set once the historical window is fully drained; incremental sync takes
    -- over from here.
    completed_at   TIMESTAMPTZ,
    last_error     TEXT,
    attempt_count  INTEGER NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (connection_id, record_type)
);
CREATE INDEX sync_checkpoints_pending_idx
    ON sync_checkpoints (org_id, connection_id) WHERE completed_at IS NULL;

-- Per-tenant data encryption keys (envelope encryption).
--
-- The DEK is stored WRAPPED by a KMS-held root key and is never persisted in
-- plaintext. A dumped database therefore yields no usable provider credentials,
-- and a single compromised key exposes one tenant rather than all of them.
CREATE TABLE tenant_data_keys (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Ciphertext of the DEK under the KMS root key, base64 in TEXT (see the note
    -- on connections.credentials_encrypted in 0001).
    wrapped_key    TEXT NOT NULL,
    kms_key_id     TEXT NOT NULL,
    -- Incremented on rotation. Old versions are retained so existing ciphertext
    -- stays decryptable without a bulk re-encrypt.
    version        INTEGER NOT NULL DEFAULT 1,
    is_current     BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at     TIMESTAMPTZ,
    UNIQUE (org_id, version)
);
CREATE UNIQUE INDEX tenant_data_keys_current_idx
    ON tenant_data_keys (org_id) WHERE is_current;

-- Connections gain the fields the backfill orchestrator needs.
ALTER TABLE connections
    ADD COLUMN token_expires_at   TIMESTAMPTZ,
    ADD COLUMN realm_id           TEXT,
    ADD COLUMN backfill_started_at TIMESTAMPTZ,
    ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;

-- RLS for the new tenant-scoped tables. Same shape as 0002; see that file for
-- why FORCE and the NULL-safe comparison both matter.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['raw_payloads','sync_checkpoints','tenant_data_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgeriq_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON raw_payloads, sync_checkpoints, tenant_data_keys '
         || 'TO ledgeriq_app';
    -- The archive is immutable: the application may write a payload record and
    -- read it back, but never rewrite history.
    EXECUTE 'REVOKE UPDATE ON raw_payloads FROM ledgeriq_app';
  END IF;
END $$;
