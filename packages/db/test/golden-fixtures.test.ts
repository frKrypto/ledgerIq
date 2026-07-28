import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAgency } from '@ledgeriq/seed';
import { normalizeQuickBooksBusiness } from '@ledgeriq/normalize';
import {
  arAging,
  cashPosition,
  cogs,
  expensesByCategory,
  grossMargin,
  monthlySeries,
  netProfit,
  operatingExpenses,
  revenue,
  revenueByCustomer,
  monthPeriod,
  type MetricContext,
} from '@ledgeriq/metrics';
import { withTenant, type TenantContext } from '../src/tenant-context.js';
import * as canonicalRepo from '../src/repositories/canonical.js';
import { setupTestDatabase, seedTwoTenants, type TestDatabase } from './helpers/database.js';

/**
 * Golden fixtures — exact equality, not approximate.
 *
 * The reconciliation harness proves we agree with QuickBooks *today*. This proves
 * we still agree tomorrow: every metric is pinned to an exact value over a frozen
 * business, so any change that moves a number has to be a deliberate act with a
 * updated expectation, rather than something noticed three weeks later by a
 * customer.
 *
 * Exact equality is the whole point. `toBeCloseTo` on financial figures is how a
 * cent-level rounding regression ships — and cent-level rounding regressions are
 * precisely what a money layer exists to prevent, so a test suite that tolerates
 * them is testing nothing.
 *
 * The fixture is deterministic by seed and pinned to a FIXED as-of date. Deriving
 * the window from `new Date()` would make the expected values drift daily and
 * force whoever hits the failure to re-baseline, which converts a regression
 * detector into a chore.
 */

// Fixed by construction. Change either of these and every expectation below must
// be re-derived deliberately — that friction is the feature.
const FIXTURE_SEED = 42;
const FIXTURE_AS_OF = new Date('2026-06-30T00:00:00Z');
const FIXTURE_MONTHS = 24;

let db: TestDatabase;
let tenants: Awaited<ReturnType<typeof seedTwoTenants>>;
let ctx: MetricContext;

beforeAll(async () => {
  db = await setupTestDatabase();
  tenants = await seedTwoTenants(db.adminPool);

  const business = generateAgency({
    seed: FIXTURE_SEED,
    months: FIXTURE_MONTHS,
    asOf: FIXTURE_AS_OF,
  });
  const canonical = normalizeQuickBooksBusiness(business as unknown as Record<string, unknown[]>);

  const tenantCtx: TenantContext = {
    orgId: tenants.orgA,
    actor: { type: 'system', jobName: 'golden-fixture' },
  };
  await withTenant(db.appPool, tenantCtx, async (d) => {
    const ledgerMap = await canonicalRepo.upsertLedgerAccounts(d, canonical.accounts);
    const customerMap = await canonicalRepo.upsertCustomers(d, canonical.customers);
    const categoryMap = await canonicalRepo.loadCategoryMap(d);
    await canonicalRepo.upsertInvoices(d, canonical.invoices, customerMap);
    await canonicalRepo.upsertTransactions(
      d,
      canonical.transactions,
      { ledgerAccounts: ledgerMap, customers: customerMap, categories: categoryMap },
      'golden',
    );
  });

  ctx = {
    pool: db.appPool,
    orgId: tenants.orgA,
    // A closed, fully-elapsed month. A period ending "today" would make every
    // expectation a function of when the suite happens to run.
    period: monthPeriod(2026, 5),
  };
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/**
 * Regenerate expectations with:
 *   npx vitest run packages/db/test/golden-fixtures.test.ts --reporter=verbose
 * and read the received values from the failure output. Do NOT paste them in
 * without checking that the change was intended — that turns this suite into a
 * rubber stamp.
 */
const EXPECTED: Record<string, number | null> = {
  revenueMinor: 30_730_857,
  cogsMinor: 9_682_781,
  opexMinor: 17_055_838,
  netProfitMinor: 3_992_238,
  grossMarginPct: 68.49,
  cashMinor: 195_106_681,
};

describe('golden fixture — May 2026, seed 42', () => {
  it('is a business with substance, not an empty set', async () => {
    // Guards the failure mode that makes every other assertion here vacuous.
    const r = await revenue(ctx);
    expect(r.confidence).not.toBe('insufficient_data');
    expect(r.value).toBeGreaterThan(0);
  });

  it('pins every P&L metric to an exact value', async () => {
    const [rev, cost, opex, profit, margin, cash] = await Promise.all([
      revenue(ctx), cogs(ctx), operatingExpenses(ctx), netProfit(ctx),
      grossMargin(ctx), cashPosition(ctx),
    ]);

    const actual = {
      revenueMinor: rev.value,
      cogsMinor: cost.value,
      opexMinor: opex.value,
      netProfitMinor: profit.value,
      grossMarginPct: margin.value,
      cashMinor: cash.value,
    };

    for (const [key, expected] of Object.entries(EXPECTED)) {
      if (expected === null) {
        // First run: report the values so they can be reviewed and pinned.
        console.log(`  GOLDEN  ${key}: ${actual[key as keyof typeof actual]}`);
        continue;
      }
      expect(`${key}=${actual[key as keyof typeof actual]}`).toBe(`${key}=${expected}`);
    }
  });

  it('keeps the accounting identity: revenue − cogs − opex = net profit', async () => {
    // Not a pinned constant — a relationship that must hold for ANY fixture.
    // Pinned values catch drift; this catches a whole class of definition bugs
    // that drift alone would happily bake in as the new baseline.
    const [rev, cost, opex, profit] = await Promise.all([
      revenue(ctx), cogs(ctx), operatingExpenses(ctx), netProfit(ctx),
    ]);
    expect((rev.value ?? 0) - (cost.value ?? 0) - (opex.value ?? 0)).toBe(profit.value);
  });

  it('keeps gross margin consistent with revenue and cogs', async () => {
    const [rev, cost, margin] = await Promise.all([revenue(ctx), cogs(ctx), grossMargin(ctx)]);
    const derived = (((rev.value ?? 0) - (cost.value ?? 0)) / (rev.value ?? 1)) * 100;
    // To the engine's own stated precision — grossMargin rounds to two decimals
    // deliberately, and asserting past that would be testing a contract the
    // engine never made rather than the consistency this case is about.
    expect(margin.value).toBeCloseTo(derived, 2);
  });

  it('keeps every breakdown summing to its own total', async () => {
    // A breakdown whose parts do not add up to the headline is the single most
    // corrosive bug class in a finance product: both numbers look plausible and
    // only their sum betrays the error.
    const [byCategory, byCustomer, rev] = await Promise.all([
      expensesByCategory(ctx), revenueByCustomer(ctx), revenue(ctx),
    ]);

    const customerTotal = byCustomer.reduce((s, r) => s + r.value, 0);
    expect(customerTotal).toBe(rev.value);

    const shareSum = byCategory.reduce((s, r) => s + r.share, 0);
    expect(shareSum).toBeCloseTo(1, 6);
  });

  it('keeps the monthly series consistent with the period metrics', async () => {
    const series = await monthlySeries(ctx, 24);
    const may = series.find((m) => m.month === '2026-05');
    const [rev, cost] = await Promise.all([revenue(ctx), cogs(ctx)]);

    expect(may?.revenue).toBe(rev.value);
    expect(may?.cogs).toBe(cost.value);
  });

  it('produces AR aging buckets that do not overlap or lose invoices', async () => {
    const buckets = await arAging(ctx);
    const totalCount = buckets.reduce((s, b) => s + b.count, 0);

    const { rows } = await db.adminPool.query<{ n: string; total: string }>(
      `SELECT count(*) AS n, coalesce(sum(balance),0) AS total FROM invoices
        WHERE org_id = $1 AND status <> 'paid' AND balance > 0 AND voided_at IS NULL`,
      [tenants.orgA],
    );

    expect(totalCount).toBe(Number(rows[0]?.n));
    const bucketTotal = buckets.reduce((s, b) => s + b.minorUnits, 0);
    expect(bucketTotal).toBe(Math.round(Number(rows[0]?.total) * 100));
  });

  it('is reproducible — the same seed regenerates identical records', () => {
    const a = generateAgency({ seed: FIXTURE_SEED, months: 6, asOf: FIXTURE_AS_OF });
    const b = generateAgency({ seed: FIXTURE_SEED, months: 6, asOf: FIXTURE_AS_OF });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is sensitive to the seed — a different seed produces a different business', () => {
    // Without this, a generator that silently ignored its seed would make the
    // reproducibility test above pass for the wrong reason.
    const a = generateAgency({ seed: FIXTURE_SEED, months: 6, asOf: FIXTURE_AS_OF });
    const b = generateAgency({ seed: FIXTURE_SEED + 1, months: 6, asOf: FIXTURE_AS_OF });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
