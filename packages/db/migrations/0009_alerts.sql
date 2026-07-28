-- 0009 — alerts, and the machinery that keeps them from becoming noise.
--
-- An alert product fails in one specific way: it cries wolf, the user mutes it,
-- and every genuine warning afterwards is invisible. That failure is silent and
-- irreversible — nobody un-mutes. So the interesting columns here are not the
-- ones that let us send an alert, they are the ones that stop us.
--
--   dedup_key      the same condition never fires twice
--   materiality    what it is worth, so trivia can be filtered per business
--   feedback       "not useful" is the signal that tunes the thresholds
--   confirmations  how many consecutive evaluations agreed before we sent it

CREATE TYPE alert_severity AS ENUM ('critical', 'high', 'medium', 'info');
CREATE TYPE alert_state    AS ENUM ('pending', 'sent', 'acknowledged', 'dismissed', 'resolved');

CREATE TABLE alerts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_key      TEXT NOT NULL,
    severity      alert_severity NOT NULL,
    state         alert_state NOT NULL DEFAULT 'pending',
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,

    -- Slotted figures with provenance, the same contract answers use: the text
    -- references computed values rather than restating them, so a number can
    -- never drift from the sentence around it.
    figures       JSONB NOT NULL DEFAULT '{}',
    recommended_action JSONB,

    -- Suppression. One row per condition per org, ever.
    dedup_key     TEXT NOT NULL,

    -- What this is worth, in minor units. Absolute thresholds do not survive
    -- contact with a customer base: $5,000 is an emergency at $200K revenue and
    -- rounding error at $20M, so the rule stores the amount and the threshold is
    -- expressed relative to the business.
    materiality   NUMERIC(20,4),

    -- Consecutive evaluations that agreed before this fired. A forecast is
    -- probabilistic; a risk that appears once and vanishes is noise, and paging
    -- someone about it is how the mute button gets pressed.
    confirmations INTEGER NOT NULL DEFAULT 1,

    triggered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at       TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    dismissed_at  TIMESTAMPTZ,
    resolved_at   TIMESTAMPTZ,
    feedback      TEXT CHECK (feedback IN ('useful', 'not_useful', 'wrong')),

    UNIQUE (org_id, dedup_key)
);
CREATE INDEX alerts_state_idx ON alerts (org_id, state, triggered_at DESC);

-- Pending observations of a risk that has not yet earned an alert. This is where
-- the confirmation requirement lives: seen once, wait; seen enough, fire.
CREATE TABLE alert_observations (
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    dedup_key    TEXT NOT NULL,
    rule_key     TEXT NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    sightings    INTEGER NOT NULL DEFAULT 1,
    payload      JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (org_id, dedup_key)
);

CREATE TABLE weekly_briefs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    week_ending  DATE NOT NULL,
    headline     TEXT NOT NULL,
    sections     JSONB NOT NULL DEFAULT '[]',
    figures      JSONB NOT NULL DEFAULT '{}',
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at      TIMESTAMPTZ,
    opened_at    TIMESTAMPTZ,
    UNIQUE (org_id, week_ending)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['alerts', 'alert_observations', 'weekly_briefs']
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgeriq_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON alerts, alert_observations, weekly_briefs '
         || 'TO ledgeriq_app';
    -- Observations are working state, not a financial record, so this is the one
    -- place the app legitimately needs DELETE: a risk that goes away must stop
    -- accumulating sightings, or it fires the moment it briefly reappears.
    EXECUTE 'GRANT DELETE ON alert_observations TO ledgeriq_app';
  END IF;
END $$;
