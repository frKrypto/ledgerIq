import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { withTenant, type TenantContext } from '../tenant-context.js';
import { forecasts } from '../schema/index.js';

/**
 * Forecast persistence and scoring — the accuracy flywheel.
 *
 * `buildCashForecast` used to compute a forecast and throw it away. That is fine
 * for rendering a chart and fatal for the strategy: forecast accuracy is the
 * defensibility bet, and the record of what we predicted cannot be reconstructed
 * after the fact. There is no query that recovers what the engine would have said
 * last month.
 *
 * Two rules this file exists to enforce:
 *
 *   1. Every forecast shown to a user is written down first.
 *   2. A forecast is scored only once the ledger genuinely covers its target
 *      date. Scoring against a partial ledger records a fabricated error and
 *      permanently poisons the series it exists to build.
 */

/** The horizons we make claims about. Fixed, because they are different claims. */
export const SCORED_HORIZONS = [7, 30, 90] as const;
export type ScoredHorizon = (typeof SCORED_HORIZONS)[number];

/** The subset of a Forecast this layer needs; avoids a dependency on @ledgeriq/metrics. */
export interface PersistableForecast {
  readonly generatedAt: string;
  readonly horizonDays: number;
  readonly points: ReadonlyArray<{ date: string; p10: number; p50: number; p90: number }>;
  readonly riskEvents: readonly unknown[];
  readonly assumptions: readonly unknown[];
  readonly confidence: string;
  readonly historyDays: number;
  readonly methodVersion: string;
}

const money = (minorUnits: number): string => (minorUnits / 100).toFixed(4);

export async function saveForecast(
  pool: Pool,
  ctx: TenantContext,
  forecast: PersistableForecast,
  kind = 'cash',
  isBackfilled = false,
): Promise<string> {
  return withTenant(pool, ctx, async (db) => {
    const [row] = await db
      .insert(forecasts)
      .values({
        orgId: ctx.orgId,
        kind,
        horizonDays: forecast.horizonDays,
        generatedAt: new Date(forecast.generatedAt),
        points: forecast.points,
        riskEvents: forecast.riskEvents,
        assumptions: forecast.assumptions,
        methodVersion: forecast.methodVersion,
        confidence: forecast.confidence,
        historyDays: forecast.historyDays,
        isBackfilled,
      })
      .returning({ id: forecasts.id });
    if (!row) throw new Error('forecast insert returned no row');
    return row.id;
  });
}

/**
 * Record today's forecast, once.
 *
 * A forecast is a daily claim about the future, not a log line — writing one per
 * page render would turn the accuracy series into a popularity measure, where a
 * business someone refreshed forty times outweighs one they looked at once.
 *
 * Deduping on the day *and* the method version is deliberate: shipping a new
 * engine mid-day is exactly when you want a fresh claim on record, because the
 * old one no longer describes what the product would say.
 */
export async function saveForecastDaily(
  pool: Pool,
  ctx: TenantContext,
  forecast: PersistableForecast,
  kind = 'cash',
  isBackfilled = false,
): Promise<{ id: string; created: boolean }> {
  const day = forecast.generatedAt.slice(0, 10);

  const existing = await withTenant(pool, ctx, async (db) => {
    const r = await db.execute<{ id: string }>(
      sql`SELECT id FROM forecasts
           WHERE kind = ${kind}
             AND generated_at::date = ${day}::date
             AND method_version = ${forecast.methodVersion}
             AND is_backfilled = ${isBackfilled}
           LIMIT 1`,
    );
    return r.rows[0]?.id ?? null;
  });
  if (existing) return { id: existing, created: false };

  return { id: await saveForecast(pool, ctx, forecast, kind, isBackfilled), created: true };
}

export interface ScoreResult {
  readonly forecastId: string;
  readonly horizonDays: number;
  readonly targetDate: string;
  readonly predictedP50Minor: number;
  readonly actualMinor: number;
  readonly signedErrorMinor: number;
  readonly absPctError: number;
  readonly withinBand: boolean;
}

export interface ScoringSummary {
  readonly scored: ScoreResult[];
  /** Forecasts whose target date has passed but whose ledger doesn't reach it yet. */
  readonly deferredForMissingData: number;
  /** Already scored on a previous run. */
  readonly alreadyScored: number;
}

interface ForecastRow extends Record<string, unknown> {
  id: string;
  generated_at: string;
  method_version: string;
  is_backfilled: boolean;
  points: Array<{ date: string; p10: number; p50: number; p90: number }>;
}

/**
 * Score every forecast whose horizons have come due.
 *
 * Idempotent: re-running scores nothing twice, so this is safe to schedule
 * aggressively and safe to run by hand while debugging.
 */
export async function scoreDueForecasts(
  pool: Pool,
  ctx: TenantContext,
  opts: { asOf?: Date } = {},
): Promise<ScoringSummary> {
  const asOf = opts.asOf ?? new Date();
  const asOfKey = asOf.toISOString().slice(0, 10);

  return withTenant(pool, ctx, async (db) => {
    // How far the ledger actually reaches. This is the guard that separates a
    // real accuracy series from a fabricated one: a business whose books are
    // three weeks behind has no actuals for last week, and scoring against the
    // cash it happens to have recorded so far would book a large error that
    // says nothing about the model.
    const coverage = await db.execute<{ latest: string | null }>(
      sql`SELECT max(posted_at)::text AS latest FROM transactions
           WHERE posted_at IS NOT NULL AND is_canonical
             AND NOT is_transfer AND voided_at IS NULL`,
    );
    const ledgerThrough = coverage.rows[0]?.latest ?? null;
    if (ledgerThrough === null) {
      return { scored: [], deferredForMissingData: 0, alreadyScored: 0 };
    }

    const due = await db.execute<ForecastRow>(
      sql`SELECT id, generated_at::text AS generated_at, method_version, is_backfilled, points
            FROM forecasts
           WHERE kind = 'cash'
             AND generated_at::date <= ${asOfKey}::date - INTERVAL '7 days'
           ORDER BY generated_at`,
    );

    const scored: ScoreResult[] = [];
    let deferred = 0;
    let already = 0;

    for (const row of due.rows) {
      const generatedDate = row.generated_at.slice(0, 10);

      for (const horizon of SCORED_HORIZONS) {
        const target = addDaysKey(generatedDate, horizon);
        if (target > asOfKey) continue; // hasn't come due yet
        if (target > ledgerThrough) {
          // Due, but the books don't reach it. Leave it; a later run will pick
          // it up once the data lands. Never score what we cannot observe.
          deferred++;
          continue;
        }

        const point = row.points.find((p) => p.date === target);
        if (!point) continue; // horizon beyond this forecast's own span

        // The actual, computed exactly the way the forecast's starting position
        // is computed — settled cash as of the target date. Comparing against a
        // differently-defined "cash" would measure the definition, not the model.
        const actualRows = await db.execute<{ net: string }>(
          sql`SELECT coalesce(sum(CASE WHEN direction='inflow' THEN amount ELSE -amount END), 0) AS net
                FROM transactions
               WHERE posted_at IS NOT NULL AND posted_at <= ${target}::date
                 AND is_canonical AND NOT is_transfer AND voided_at IS NULL`,
        );
        const actualMinor = Math.round(Number(actualRows.rows[0]?.net ?? 0) * 100);

        const signedError = point.p50 - actualMinor;
        // Guard the zero-actual case rather than emitting Infinity, which would
        // poison every average computed over this column.
        const absPctError = actualMinor === 0
          ? (signedError === 0 ? 0 : 1)
          : Math.abs(signedError) / Math.abs(actualMinor);
        const withinBand = actualMinor >= point.p10 && actualMinor <= point.p90;

        const inserted = await db.execute<{ id: string }>(
          sql`INSERT INTO forecast_scores
                (org_id, forecast_id, horizon_days, target_date, predicted_p50,
                 predicted_p10, predicted_p90, actual, signed_error, abs_pct_error,
                 within_band, method_version, is_backfilled)
              VALUES (${ctx.orgId}::uuid, ${row.id}::uuid, ${horizon}, ${target}::date,
                      ${money(point.p50)}, ${money(point.p10)}, ${money(point.p90)},
                      ${money(actualMinor)}, ${money(signedError)}, ${absPctError.toFixed(6)},
                      ${withinBand}, ${row.method_version}, ${row.is_backfilled})
              ON CONFLICT (forecast_id, horizon_days) DO NOTHING
              RETURNING id`,
        );

        if (inserted.rows.length === 0) {
          already++;
          continue;
        }

        scored.push({
          forecastId: row.id,
          horizonDays: horizon,
          targetDate: target,
          predictedP50Minor: point.p50,
          actualMinor,
          signedErrorMinor: signedError,
          absPctError,
          withinBand,
        });
      }
    }

    return { scored, deferredForMissingData: deferred, alreadyScored: already };
  });
}

export interface AccuracyBucket {
  readonly horizonDays: number;
  /** Backfilled scores are a weaker claim and are reported separately. See 0007. */
  readonly isBackfilled: boolean;
  readonly n: number;
  readonly medianAbsPctError: number;
  readonly bandCoverage: number;
  /** Mean signed error. Persistent non-zero means bias, which is fixable. */
  readonly meanSignedErrorMinor: number;
  readonly methodVersion: string;
}

/**
 * The flywheel, read back.
 *
 * Median rather than mean absolute error: one catastrophic month (a business
 * takes a loan, a customer pays a year up front) would otherwise dominate the
 * number and hide steady improvement everywhere else.
 */
export async function accuracySummary(
  pool: Pool,
  ctx: TenantContext,
): Promise<AccuracyBucket[]> {
  return withTenant(pool, ctx, async (db) => {
    const res = await db.execute<{
      horizon_days: number; is_backfilled: boolean; n: string; median_ape: string;
      band_coverage: string; mean_signed: string; method_version: string;
    }>(
      // Grouped by is_backfilled AND method_version, never averaged across
      // either. A re-run of today's engine over tidied books is not evidence
      // about the engine we shipped, and averaging two engines together hides
      // exactly the improvement the flywheel exists to detect — the first
      // calibrated release showed 40% band coverage purely because it was being
      // averaged with the uncalibrated one it replaced.
      sql`SELECT horizon_days, is_backfilled, method_version,
                 count(*)                                                         AS n,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY abs_pct_error)       AS median_ape,
                 avg(CASE WHEN within_band THEN 1.0 ELSE 0.0 END)                 AS band_coverage,
                 avg(signed_error)                                                AS mean_signed
            FROM forecast_scores
           GROUP BY horizon_days, is_backfilled, method_version
           ORDER BY method_version, is_backfilled, horizon_days`,
    );
    return res.rows.map((r) => ({
      horizonDays: Number(r.horizon_days),
      isBackfilled: r.is_backfilled,
      n: Number(r.n),
      medianAbsPctError: Number(r.median_ape),
      bandCoverage: Number(r.band_coverage),
      meanSignedErrorMinor: Math.round(Number(r.mean_signed) * 100),
      methodVersion: r.method_version,
    }));
  });
}

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
