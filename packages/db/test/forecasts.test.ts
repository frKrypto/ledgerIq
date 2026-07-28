import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { setupTestDatabase, seedTwoTenants, type TestDatabase } from './helpers/database.js';
import {
  saveForecast,
  scoreDueForecasts,
  accuracySummary,
  type PersistableForecast,
} from '../src/repositories/forecasts.js';
import { withTenant, type TenantContext } from '../src/tenant-context.js';

/**
 * The accuracy flywheel.
 *
 * The claim under test is not "rows go in and come out." It is that the series
 * this table accumulates is *trustworthy* — because it is the one dataset in the
 * product that cannot be rebuilt if it turns out to be wrong. Two failure modes
 * matter more than the happy path:
 *
 *   - Scoring against a ledger that does not reach the target date, which records
 *     a large error that says nothing about the model.
 *   - Double-scoring on a re-run, which silently inflates the history.
 */

let db: TestDatabase;
let tenants: Awaited<ReturnType<typeof seedTwoTenants>>;
let ctxA: TenantContext;
let ctxB: TenantContext;

beforeAll(async () => {
  db = await setupTestDatabase();
  tenants = await seedTwoTenants(db.adminPool);
  ctxA = { orgId: tenants.orgA, actor: { type: 'system', jobName: 'forecast-test' } };
  ctxB = { orgId: tenants.orgB, actor: { type: 'system', jobName: 'forecast-test' } };
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.adminPool.query('DELETE FROM forecast_scores');
  await db.adminPool.query('DELETE FROM forecasts');
  await db.adminPool.query('DELETE FROM transactions');
});

const DAY = 86400000;
const key = (d: Date): string => d.toISOString().slice(0, 10);
const daysBefore = (n: number): Date => new Date(Date.now() - n * DAY);

/** A forecast generated `generatedDaysAgo` ago, flat at `p50Minor` with a ±band. */
function makeForecast(
  generatedDaysAgo: number,
  p50Minor: number,
  bandMinor = 50_000_00,
): PersistableForecast {
  const generated = daysBefore(generatedDaysAgo);
  const points = [];
  for (let i = 1; i <= 91; i++) {
    points.push({
      date: key(new Date(generated.getTime() + i * DAY)),
      p10: p50Minor - bandMinor,
      p50: p50Minor,
      p90: p50Minor + bandMinor,
    });
  }
  return {
    generatedAt: generated.toISOString(),
    horizonDays: 91,
    points,
    riskEvents: [],
    assumptions: [],
    confidence: 'medium',
    historyDays: 400,
    methodVersion: '2026.07.1',
  };
}

/**
 * Two different dates matter here and conflating them is what made the first
 * version of these fixtures wrong:
 *
 *   - the date a transaction posted, which sets the cash position from then on
 *   - the date the ledger *reaches*, which is what the scorer checks before it
 *     is willing to call anything an actual
 *
 * `seedCash` moves the position. `bookkeepingCurrentThrough` moves only the
 * coverage — a zero-amount row extends max(posted_at) without changing any
 * position, standing in for "the books have been written up through this date."
 */
async function seedCash(orgId: string, postedOn: Date, minorUnits: number): Promise<void> {
  await db.adminPool.query(
    `INSERT INTO transactions
       (org_id, source, source_txn_id, occurred_at, posted_at, amount, currency,
        direction, description, is_canonical, is_transfer, transform_version)
     VALUES ($1, 'quickbooks', $2, $3::date, $3::date, $4, 'USD', 'inflow', 'fixture',
             true, false, 'test')`,
    [orgId, `fx-${Math.random().toString(36).slice(2)}`, key(postedOn), (minorUnits / 100).toFixed(4)],
  );
}

async function bookkeepingCurrentThrough(orgId: string, through: Date): Promise<void> {
  await seedCash(orgId, through, 0);
}

describe('forecast persistence', () => {
  it('round-trips a forecast', async () => {
    const id = await saveForecast(db.appPool, ctxA, makeForecast(0, 1_000_000_00));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await withTenant(db.appPool, ctxA, async (d) => {
      const r = await d.execute<{ n: string; method_version: string }>(
        sql`SELECT count(*) AS n, min(method_version) AS method_version FROM forecasts`,
      );
      return r.rows;
    });
    expect(Number(rows[0]?.n)).toBe(1);
    expect(rows[0]?.method_version).toBe('2026.07.1');
  });

  it('does not leak forecasts across tenants', async () => {
    await saveForecast(db.appPool, ctxA, makeForecast(0, 1_000_000_00));

    // Counted through the tenant-scoped connection: RLS is the thing on trial.
    const seenByB = await withTenant(db.appPool, ctxB, async (d) => {
      const r = await d.execute<{ n: string }>(sql`SELECT count(*) AS n FROM forecasts`);
      return Number(r.rows[0]?.n ?? -1);
    });
    expect(seenByB).toBe(0);
  });
});

describe('scoring', () => {
  it('scores a due horizon against the real cash position', async () => {
    // Predicted $1,000,000 for a target 7 days after generation; actual $950,000.
    await seedCash(tenants.orgA, daysBefore(40), 950_000_00);
    await bookkeepingCurrentThrough(tenants.orgA, daysBefore(1));
    await saveForecast(db.appPool, ctxA, makeForecast(10, 1_000_000_00));

    const summary = await scoreDueForecasts(db.appPool, ctxA);
    const seven = summary.scored.find((s) => s.horizonDays === 7);

    expect(seven).toBeDefined();
    expect(seven?.actualMinor).toBe(950_000_00);
    expect(seven?.predictedP50Minor).toBe(1_000_000_00);
    // Over-predicted, so the signed error is positive — the sign is the point.
    expect(seven?.signedErrorMinor).toBe(50_000_00);
    expect(seven?.absPctError).toBeCloseTo(0.052631, 5);
    // $950k sits inside 1,000k ± 50k, inclusive at the boundary.
    expect(seven?.withinBand).toBe(true);
  });

  it('marks a miss outside the band as outside the band', async () => {
    await seedCash(tenants.orgA, daysBefore(40), 800_000_00);
    await bookkeepingCurrentThrough(tenants.orgA, daysBefore(1));
    await saveForecast(db.appPool, ctxA, makeForecast(10, 1_000_000_00));

    const summary = await scoreDueForecasts(db.appPool, ctxA);
    expect(summary.scored.find((s) => s.horizonDays === 7)?.withinBand).toBe(false);
  });

  it('REFUSES to score when the ledger does not reach the target date', async () => {
    // The guard that makes this series worth keeping.
    //
    // The forecast was generated 10 days ago, so its 7-day horizon came due 3
    // days ago. But the books stop 30 days back — this business is behind on
    // its bookkeeping. Scoring here would compare a forecast of future cash
    // against a ledger missing three weeks of it, and book a fabricated ~40%
    // error against the model.
    await seedCash(tenants.orgA, daysBefore(30), 600_000_00);
    await saveForecast(db.appPool, ctxA, makeForecast(10, 1_000_000_00));

    const summary = await scoreDueForecasts(db.appPool, ctxA);
    expect(summary.scored).toHaveLength(0);
    expect(summary.deferredForMissingData).toBe(1);
  });

  it('picks the deferred score up once the data lands', async () => {
    await seedCash(tenants.orgA, daysBefore(30), 600_000_00);
    await saveForecast(db.appPool, ctxA, makeForecast(10, 1_000_000_00));
    expect((await scoreDueForecasts(db.appPool, ctxA)).scored).toHaveLength(0);

    // Bookkeeping catches up, and the business also took in $400k two days ago.
    await seedCash(tenants.orgA, daysBefore(2), 400_000_00);

    const after = await scoreDueForecasts(db.appPool, ctxA);
    expect(after.scored).toHaveLength(1);
    // The actual is cash *as of the target date*, not cash today. The $400k
    // landed after the target, so it must not count towards this score —
    // otherwise every score silently drifts towards the present.
    expect(after.scored[0]?.actualMinor).toBe(600_000_00);
    expect(after.scored[0]?.signedErrorMinor).toBe(400_000_00);
  });

  it('is idempotent — a second run scores nothing twice', async () => {
    await seedCash(tenants.orgA, daysBefore(40), 950_000_00);
    await bookkeepingCurrentThrough(tenants.orgA, daysBefore(1));
    await saveForecast(db.appPool, ctxA, makeForecast(10, 1_000_000_00));

    const first = await scoreDueForecasts(db.appPool, ctxA);
    const second = await scoreDueForecasts(db.appPool, ctxA);

    expect(first.scored).toHaveLength(1);
    expect(second.scored).toHaveLength(0);
    expect(second.alreadyScored).toBe(1);

    const { rows } = await db.adminPool.query(
      'SELECT count(*) AS n FROM forecast_scores WHERE org_id = $1',
      [tenants.orgA],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('scores every horizon that has come due, and no horizon that has not', async () => {
    await seedCash(tenants.orgA, daysBefore(1), 1_000_000_00);
    // Generated 45 days ago: the 7- and 30-day horizons are due, the 90 is not.
    await saveForecast(db.appPool, ctxA, makeForecast(45, 1_000_000_00));

    const summary = await scoreDueForecasts(db.appPool, ctxA);
    expect(summary.scored.map((s) => s.horizonDays).sort((a, b) => a - b)).toEqual([7, 30]);
  });

  it('ignores forecasts too young to have a due horizon', async () => {
    await seedCash(tenants.orgA, daysBefore(1), 1_000_000_00);
    await saveForecast(db.appPool, ctxA, makeForecast(3, 1_000_000_00));

    expect((await scoreDueForecasts(db.appPool, ctxA)).scored).toHaveLength(0);
  });

  it('does not divide by zero when actual cash is zero', async () => {
    await bookkeepingCurrentThrough(tenants.orgA, daysBefore(1));
    await saveForecast(db.appPool, ctxA, makeForecast(10, 1_000_000_00));

    const summary = await scoreDueForecasts(db.appPool, ctxA);
    const ape = summary.scored.find((s) => s.horizonDays === 7)?.absPctError;
    expect(Number.isFinite(ape)).toBe(true);
    expect(ape).toBe(1);
  });

  it('scores one tenant without touching another', async () => {
    await seedCash(tenants.orgA, daysBefore(40), 950_000_00);
    await seedCash(tenants.orgB, daysBefore(40), 111_111_00);
    await bookkeepingCurrentThrough(tenants.orgA, daysBefore(1));
    await bookkeepingCurrentThrough(tenants.orgB, daysBefore(1));
    await saveForecast(db.appPool, ctxA, makeForecast(10, 1_000_000_00));
    await saveForecast(db.appPool, ctxB, makeForecast(10, 1_000_000_00));

    await scoreDueForecasts(db.appPool, ctxA);

    const { rows } = await db.adminPool.query(
      'SELECT org_id, count(*) AS n FROM forecast_scores GROUP BY org_id',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].org_id).toBe(tenants.orgA);

    // And B's actual is B's, not A's — the scoped actual query must not see A.
    await scoreDueForecasts(db.appPool, ctxB);
    const { rows: bRows } = await db.adminPool.query(
      'SELECT actual FROM forecast_scores WHERE org_id = $1 AND horizon_days = 7',
      [tenants.orgB],
    );
    expect(Number(bRows[0].actual)).toBe(111_111);
  });
});

describe('accuracy summary', () => {
  it('reports median error, band coverage, and signed bias per horizon', async () => {
    await seedCash(tenants.orgA, daysBefore(60), 1_000_000_00);
    await bookkeepingCurrentThrough(tenants.orgA, daysBefore(1));
    // Three forecasts, all over-predicting by a different amount. A consistent
    // positive mean signed error is the signature of fixable bias.
    await saveForecast(db.appPool, ctxA, makeForecast(20, 1_100_000_00));
    await saveForecast(db.appPool, ctxA, makeForecast(21, 1_200_000_00));
    await saveForecast(db.appPool, ctxA, makeForecast(22, 1_050_000_00));
    await scoreDueForecasts(db.appPool, ctxA);

    const summary = await accuracySummary(db.appPool, ctxA);
    const seven = summary.find((s) => s.horizonDays === 7);

    expect(seven?.n).toBe(3);
    // Errors are 10%, 20%, 5% → median 10%.
    expect(seven?.medianAbsPctError).toBeCloseTo(0.1, 4);
    expect(seven?.meanSignedErrorMinor).toBeGreaterThan(0);
    expect(seven?.methodVersion).toBe('2026.07.1');
  });

  it('returns nothing rather than a fake zero when nothing has been scored', async () => {
    expect(await accuracySummary(db.appPool, ctxA)).toEqual([]);
  });
});
