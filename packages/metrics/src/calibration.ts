import type { Pool } from 'pg';

/**
 * Empirical band calibration.
 *
 * The forecast's P10-P90 band was originally a shape with hand-picked constants
 * (`sqrt(t) * dailyVariable * 2.6 + t * $180`). The first accuracy run over the
 * demo business showed what that is worth: **0% band coverage at every horizon.**
 * An honest 80% band contains the actual about 80% of the time; one that contains
 * it never is not a confidence interval, it is decoration — and it is decoration
 * attached to the sentence the whole product is built on ("you will be short on
 * the 15th").
 *
 * So the band stops being invented and starts being measured. `forecast_scores`
 * records where actuals landed relative to each prediction; the 10th and 90th
 * percentiles of that distribution are, by construction, a calibrated band.
 *
 * Two deliberate choices:
 *
 *   - **Signed, not absolute.** The quantiles absorb systematic bias. If the
 *     engine habitually under-predicts cash, the band sits above the midpoint and
 *     says so, instead of straddling a midpoint that history says is wrong.
 *   - **The P50 is left alone.** Auto-shifting the point estimate by the observed
 *     bias would paper over whatever is causing it. The bias belongs in front of
 *     whoever can fix the model, which is what `forecast accuracy` prints.
 */

/** Below this, the quantiles are noise and the heuristic is the safer default. */
export const MIN_SCORES_FOR_CALIBRATION = 20;

export interface HorizonCalibration {
  readonly horizonDays: number;
  /** 10th percentile of (actual - p50) / |p50|. */
  readonly q10: number;
  /** 90th percentile of the same. */
  readonly q90: number;
  readonly n: number;
}

export interface Calibration {
  readonly horizons: HorizonCalibration[];
  readonly totalScores: number;
  /** True when every score behind this came from backfill — a weaker basis. */
  readonly backfilledOnly: boolean;
}

export async function loadCalibration(pool: Pool, orgId: string): Promise<Calibration | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', orgId]);
    const { rows } = await client.query<{
      horizon_days: number; q10: string; q90: string; n: string; live: string;
    }>(
      `SELECT horizon_days,
              percentile_cont(0.10) WITHIN GROUP (
                ORDER BY (actual - predicted_p50) / nullif(abs(predicted_p50), 0)) AS q10,
              percentile_cont(0.90) WITHIN GROUP (
                ORDER BY (actual - predicted_p50) / nullif(abs(predicted_p50), 0)) AS q90,
              count(*) AS n,
              count(*) FILTER (WHERE NOT is_backfilled) AS live
         FROM forecast_scores
        WHERE predicted_p50 <> 0
        GROUP BY horizon_days
        ORDER BY horizon_days`,
    );
    await client.query('COMMIT');

    const horizons = rows
      .filter((r) => Number(r.n) >= MIN_SCORES_FOR_CALIBRATION && r.q10 !== null && r.q90 !== null)
      .map((r) => ({
        horizonDays: Number(r.horizon_days),
        q10: Number(r.q10),
        q90: Number(r.q90),
        n: Number(r.n),
      }));

    if (horizons.length === 0) return null;

    return {
      horizons,
      totalScores: horizons.reduce((s, h) => s + h.n, 0),
      backfilledOnly: rows.every((r) => Number(r.live) === 0),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The calibrated band at an arbitrary day, from quantiles measured at 7/30/90.
 *
 * Linear between measured horizons; held flat outside them. Extrapolating past
 * the furthest measurement would invent exactly the kind of unmeasured confidence
 * this module exists to remove.
 */
export function bandAt(
  calibration: Calibration,
  dayIndex: number,
  p50Minor: number,
): { p10: number; p90: number } {
  const hs = calibration.horizons;
  const first = hs[0]!;
  const last = hs[hs.length - 1]!;

  let q10: number;
  let q90: number;

  if (dayIndex <= first.horizonDays) {
    // Inside the nearest measured horizon, scale down towards zero at day 0 —
    // a forecast of today's cash has no uncertainty to speak of.
    const t = dayIndex / first.horizonDays;
    q10 = first.q10 * t;
    q90 = first.q90 * t;
  } else if (dayIndex >= last.horizonDays) {
    q10 = last.q10;
    q90 = last.q90;
  } else {
    let lo = first;
    let hi = last;
    for (let i = 0; i < hs.length - 1; i++) {
      if (dayIndex >= hs[i]!.horizonDays && dayIndex <= hs[i + 1]!.horizonDays) {
        lo = hs[i]!;
        hi = hs[i + 1]!;
        break;
      }
    }
    const span = hi.horizonDays - lo.horizonDays;
    const t = span === 0 ? 0 : (dayIndex - lo.horizonDays) / span;
    q10 = lo.q10 + (hi.q10 - lo.q10) * t;
    q90 = lo.q90 + (hi.q90 - lo.q90) * t;
  }

  const scale = Math.abs(p50Minor);
  return {
    p10: Math.round(p50Minor + q10 * scale),
    p90: Math.round(p50Minor + q90 * scale),
  };
}
