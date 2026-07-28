-- 0007 — separate what we said from what we would have said.
--
-- Waiting 90 days for the first accuracy reading is a bad trade when the engine
-- can be re-run with `asOf` set to a past date and scored against what actually
-- followed. That produces a real signal today.
--
-- It is NOT the same claim, and conflating the two would quietly corrupt the one
-- series that cannot be rebuilt. A backfilled forecast is weaker in two specific
-- ways:
--
--   1. It uses TODAY's engine. It cannot tell you what the engine you shipped in
--      March would have said, so it cannot measure whether the engine improved —
--      which is the entire point of the flywheel.
--   2. It uses TODAY's books. Ledgers get amended: invoices are corrected,
--      categories reassigned, transactions voided. A backfill sees the tidied
--      version of the past, so it is systematically optimistic against what the
--      engine would really have had to work with.
--
-- So: keep both, label which is which, and never average them together. Accuracy
-- reporting filters on this column rather than trusting the caller to remember.

ALTER TABLE forecasts        ADD COLUMN is_backfilled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE forecast_scores  ADD COLUMN is_backfilled BOOLEAN NOT NULL DEFAULT false;

-- Backfill generates one forecast per historical date, so the daily-dedup lookup
-- and the accuracy split both want this.
CREATE INDEX forecasts_backfill_idx ON forecasts (org_id, is_backfilled, generated_at);
CREATE INDEX forecast_scores_backfill_idx
    ON forecast_scores (org_id, is_backfilled, horizon_days, target_date DESC);
