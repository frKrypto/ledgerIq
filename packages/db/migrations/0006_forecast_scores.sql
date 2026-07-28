-- 0006 — the flywheel table.
--
-- forecasts already exists (0005) but nothing wrote to it, which meant every
-- forecast was computed and discarded. This adds the other half: what actually
-- happened, scored against what we said would happen.
--
-- Strategically this is the most important table in the schema and it will
-- deliver no user value for a year. It earns its place because forecast accuracy
-- is the defensibility bet (README bet #6) and *this history cannot be
-- reconstructed retroactively* — there is no way to go back and learn what we
-- would have predicted last month. Every day it is not written is a day of moat
-- permanently gone. That is why it ships before anything with a UI.

CREATE TABLE forecast_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    forecast_id     UUID NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,

    -- Fixed horizons, not arbitrary ones. Accuracy at 7 days and accuracy at 90
    -- days are different claims about the model, and averaging across a
    -- continuum hides which one is improving.
    horizon_days    INTEGER NOT NULL CHECK (horizon_days IN (7, 30, 90)),

    -- The date the prediction was *for*. Stored rather than derived: horizon
    -- arithmetic off generated_at would silently shift if the forecast's own
    -- as-of ever differs from its insert time.
    target_date     DATE NOT NULL,

    predicted_p50   NUMERIC(20,4) NOT NULL,
    predicted_p10   NUMERIC(20,4) NOT NULL,
    predicted_p90   NUMERIC(20,4) NOT NULL,
    actual          NUMERIC(20,4) NOT NULL,

    -- Signed, not absolute. A model that is always 8% low is a fixable bias; a
    -- model that is 8% off in random directions is noise. Collapsing to an
    -- absolute value at write time throws away the distinction permanently.
    signed_error    NUMERIC(20,4) NOT NULL,
    abs_pct_error   NUMERIC(10,6) NOT NULL,

    -- Band calibration. If the P10-P90 band is honest, this is true about 80% of
    -- the time. Much higher means the band is uselessly wide; much lower means it
    -- is lying about its own confidence.
    within_band     BOOLEAN NOT NULL,

    -- Which engine made the claim. Without this, a method change makes the whole
    -- accuracy series incomparable and silently resets the flywheel.
    method_version  TEXT NOT NULL,

    scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Scoring is idempotent: re-running the job must not inflate the history.
    UNIQUE (forecast_id, horizon_days)
);

CREATE INDEX forecast_scores_accuracy_idx
    ON forecast_scores (org_id, horizon_days, target_date DESC);

-- Finding forecasts that are due to be scored is the job's hot path.
CREATE INDEX forecasts_scoring_idx ON forecasts (org_id, generated_at);

ALTER TABLE forecast_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON forecast_scores
  USING (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- 0003 set default privileges for future tables, but only where the role exists.
-- Re-granting explicitly keeps a database created before that role idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgeriq_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON forecast_scores TO ledgeriq_app';
    EXECUTE 'REVOKE DELETE ON forecast_scores FROM ledgeriq_app';
  END IF;
END $$;
