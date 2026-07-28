import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAgency } from '@ledgeriq/seed';
import { buildProfitAndLoss } from '@ledgeriq/connectors/test-helpers';
import {
  parseQuickBooksProfitAndLoss,
  reconcileProfitAndLoss,
  formatReport,
  type QboProfitAndLoss,
} from '@ledgeriq/reconcile';
import { normalizeQuickBooksBusiness } from '@ledgeriq/normalize';
import { withTenant, type TenantContext } from '../src/tenant-context.js';
import * as canonicalRepo from '../src/repositories/canonical.js';
import { setupTestDatabase, seedTwoTenants, type TestDatabase } from './helpers/database.js';

/**
 * The Phase 1 gate: does our canonical model agree with the source system's own
 * P&L?
 *
 * What makes this a real test rather than a tautology is where the source P&L
 * comes from. `buildProfitAndLoss` derives it from the raw QuickBooks entity
 * payloads by walking Invoice and Purchase lines and grouping by the chart of
 * accounts — the way QuickBooks derives it from the ledger. Our side gets there
 * completely differently: archive → normalize → canonical rows → SQL aggregate.
 * Two independent paths from the same source data. If normalization drops,
 * duplicates, or mis-classifies anything, the totals disagree.
 */

let db: TestDatabase;
let tenants: Awaited<ReturnType<typeof seedTwoTenants>>;
let ctx: TenantContext;
let business: ReturnType<typeof generateAgency>;
let sourcePnl: QboProfitAndLoss;
let period: { start: string; end: string };

beforeAll(async () => {
  db = await setupTestDatabase();
  tenants = await seedTwoTenants(db.adminPool);
  ctx = { orgId: tenants.orgA, actor: { type: 'system', jobName: 'reconcile-test' } };

  business = generateAgency({ months: 18 });

  // A closed window, not "to today". A partial current month is a real source of
  // spurious divergence when the two sides disagree by a day at the boundary.
  const end = new Date();
  end.setUTCDate(0); // last day of the previous month
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  period = { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };

  sourcePnl = buildProfitAndLoss(
    business as unknown as Record<string, unknown[]>,
    period.start,
    period.end,
  ) as QboProfitAndLoss;

  // Our side of the comparison, through the real normalizer.
  const canonical = normalizeQuickBooksBusiness(business as unknown as Record<string, unknown[]>);
  await withTenant(db.appPool, ctx, async (d) => {
    const ledgerMap = await canonicalRepo.upsertLedgerAccounts(d, canonical.accounts);
    const customerMap = await canonicalRepo.upsertCustomers(d, canonical.customers);
    const categoryMap = await canonicalRepo.loadCategoryMap(d);
    await canonicalRepo.upsertInvoices(d, canonical.invoices, customerMap);
    await canonicalRepo.upsertTransactions(
      d,
      canonical.transactions,
      { ledgerAccounts: ledgerMap, customers: customerMap, categories: categoryMap },
      'reconcile-test',
    );
  });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('QuickBooks report parsing', () => {
  it('does not double-count sub-accounts', () => {
    // Payroll is emitted as a parent row carrying BOTH children and a summary.
    // A walker that sums every row it meets reports payroll twice, which would
    // show up as a large, confusing expense divergence.
    const parsed = parseQuickBooksProfitAndLoss(sourcePnl);
    const payrollLines = parsed.lines.filter((l: { accountName: string; section: string; amountMinor: number }) =>
      ['Salaries & Wages', 'Payroll Taxes', 'Employee Benefits'].includes(l.accountName),
    );
    expect(payrollLines.length).toBe(3);

    const leafSum = parsed.lines
      .filter((l: { accountName: string; section: string; amountMinor: number }) => l.section === 'expense')
      .reduce((acc: number, l: { amountMinor: number }) => acc + l.amountMinor, 0);
    expect(leafSum).toBe(parsed.totals.expenses);
  });

  it('reads cents exactly, without float drift', () => {
    const parsed = parseQuickBooksProfitAndLoss({
      Header: { StartPeriod: '2026-01-01', EndPeriod: '2026-01-31' },
      Rows: {
        Row: [
          {
            group: 'Income',
            Rows: { Row: [{ ColData: [{ value: 'Fees' }, { value: '1234.35' }] }] },
            Summary: { ColData: [{ value: 'Total' }, { value: '1234.35' }] },
          },
        ],
      },
    });
    // 1234.35 * 100 in floating point is 123434.99999999999.
    expect(parsed.lines[0]?.amountMinor).toBe(123435);
  });

  it('reads parenthesised negatives the way accounting reports write them', () => {
    const parsed = parseQuickBooksProfitAndLoss({
      Header: {},
      Rows: {
        Row: [
          {
            group: 'Income',
            Rows: { Row: [{ ColData: [{ value: 'Refunds' }, { value: '(500.00)' }] }] },
            Summary: { ColData: [{ value: 'Total' }, { value: '-500.00' }] },
          },
        ],
      },
    });
    expect(parsed.lines[0]?.amountMinor).toBe(-50000);
    expect(parsed.totals.income).toBe(-50000);
  });
});

describe('reconciliation against the source P&L', () => {
  it('agrees to the cent on every section', async () => {
    const source = parseQuickBooksProfitAndLoss(sourcePnl);
    const report = await reconcileProfitAndLoss(db.appPool, tenants.orgA, source);

    // Printed on failure: a bare boolean here is useless for diagnosis, and this
    // is the exact output an engineer would want when a real company's books
    // disagree.
    if (!report.ok) console.error(`\n${formatReport(report)}\n`);

    for (const section of report.sections) {
      expect(`${section.label}: ${section.deltaMinor}`).toBe(`${section.label}: 0`);
    }
  });

  it('agrees on every individual account', async () => {
    const source = parseQuickBooksProfitAndLoss(sourcePnl);
    const report = await reconcileProfitAndLoss(db.appPool, tenants.orgA, source);
    if (!report.ok) console.error(`\n${formatReport(report)}\n`);

    expect(report.accounts.filter((a: { status: string }) => a.status !== 'match')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('is comparing something real, not two empty sets', async () => {
    // A reconciler that agrees because both sides are zero is the failure mode
    // that makes this whole suite worthless. Assert there is substance.
    const source = parseQuickBooksProfitAndLoss(sourcePnl);
    expect(source.totals.income).toBeGreaterThan(1_000_000_00);
    expect(source.lines.length).toBeGreaterThan(8);
  });

  it('CATCHES an injected divergence', async () => {
    // The mutation test for the reconciler itself. Void one transaction behind
    // the source's back; the totals must stop agreeing.
    const { rows } = await db.adminPool.query<{ id: string; amount: string }>(
      `SELECT id, amount FROM transactions
        WHERE org_id = $1 AND statement = 'revenue' AND voided_at IS NULL
        ORDER BY amount DESC LIMIT 1`,
      [tenants.orgA],
    );
    const victim = rows[0]!;
    await db.adminPool.query(`UPDATE transactions SET voided_at = now() WHERE id = $1`, [victim.id]);

    try {
      const source = parseQuickBooksProfitAndLoss(sourcePnl);
      const report = await reconcileProfitAndLoss(db.appPool, tenants.orgA, source);

      expect(report.ok).toBe(false);
      const income = report.sections.find((s: { label: string }) => s.label === 'Income')!;
      // We now under-count by exactly the voided amount.
      expect(income.deltaMinor).toBe(-Math.round(Number(victim.amount) * 100));
    } finally {
      await db.adminPool.query(`UPDATE transactions SET voided_at = NULL WHERE id = $1`, [victim.id]);
    }
  });
});
