import type { Pool } from 'pg';
import * as Money from '@ledgeriq/core/money';

/**
 * The metric engine.
 *
 * Every number the product shows originates here. Not in a template, not in a
 * component, and — per the central constraint in ai-cfo-engine.md §2 — never in
 * a language model. If the model disappeared tomorrow, every figure on every
 * surface would still compute correctly.
 *
 * Properties that make that claim real:
 *   - Metrics are pure functions of tenant-scoped SQL. No hidden state.
 *   - Every result carries provenance: the records behind it, the period, the
 *     engine version. A figure that cannot be drilled into is a bug.
 *   - A metric that cannot be computed honestly returns `insufficient_data`
 *     rather than zero. Zero is a claim; absence is the truth.
 */

export const ENGINE_VERSION = '2026.07.1';

export type Unit = 'currency' | 'ratio' | 'percent' | 'months' | 'days' | 'count';
export type Confidence = 'high' | 'medium' | 'low' | 'insufficient_data';

export interface Period {
  readonly start: string;
  readonly end: string;
  readonly grain: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'trailing_12' | 'custom';
}

export interface Provenance {
  readonly metricKey: string;
  readonly engineVersion: string;
  readonly computedAt: string;
  readonly sourceRecordCount: number;
  /** The SQL predicate behind the figure, for drill-down. */
  readonly drillDown: { statement?: string; from: string; to: string } | null;
}

export interface MetricResult {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit: Unit;
  readonly money?: { amount: string; currency: string; minorUnits: number };
  readonly period: Period;
  readonly confidence: Confidence;
  readonly reason?: string;
  readonly provenance: Provenance;
}

export interface MetricContext {
  readonly pool: Pool;
  readonly orgId: string;
  readonly period: Period;
}

/** Run a query inside this tenant's scope. */
async function scoped<T>(
  ctx: MetricContext,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', ctx.orgId]);
    const { rows } = await client.query(sql, params);
    await client.query('COMMIT');
    return rows as T[];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const money = (minorUnits: number) => ({
  amount: Money.toDecimalString(Money.money(minorUnits, 'USD')),
  currency: 'USD',
  minorUnits,
});

function provenance(
  key: string,
  count: number,
  period: Period,
  statement?: string,
): Provenance {
  return {
    metricKey: key,
    engineVersion: ENGINE_VERSION,
    computedAt: new Date().toISOString(),
    sourceRecordCount: count,
    drillDown: { from: period.start, to: period.end, ...(statement ? { statement } : {}) },
  };
}

/**
 * Sum one statement class over a period.
 *
 * The `is_canonical AND NOT is_transfer` predicate is not optional decoration:
 * without it, duplicated cross-source records and internal transfers inflate
 * both revenue and expense. It is applied here once rather than trusted to every
 * call site.
 */
async function sumStatement(
  ctx: MetricContext,
  statement: string,
  direction?: 'inflow' | 'outflow',
): Promise<{ minorUnits: number; count: number }> {
  const rows = await scoped<{ total: string; n: string }>(
    ctx,
    `SELECT coalesce(sum(amount), 0) AS total, count(*) AS n
       FROM transactions
      WHERE statement = $1::statement_class
        AND occurred_at >= $2 AND occurred_at <= $3
        AND is_canonical AND NOT is_transfer AND voided_at IS NULL
        ${direction ? 'AND direction = $4::txn_direction' : ''}`,
    direction
      ? [statement, ctx.period.start, ctx.period.end, direction]
      : [statement, ctx.period.start, ctx.period.end],
  );
  const row = rows[0];
  return {
    minorUnits: Money.fromDecimalString(row?.total ?? '0', 'USD').minorUnits,
    count: Number(row?.n ?? 0),
  };
}

// ── Metric implementations ───────────────────────────────────────────────────

export async function revenue(ctx: MetricContext): Promise<MetricResult> {
  const { minorUnits, count } = await sumStatement(ctx, 'revenue');
  return {
    key: 'revenue',
    label: 'Revenue',
    value: minorUnits,
    unit: 'currency',
    money: money(minorUnits),
    period: ctx.period,
    confidence: count === 0 ? 'insufficient_data' : 'high',
    ...(count === 0 ? { reason: 'No revenue transactions in this period' } : {}),
    provenance: provenance('revenue', count, ctx.period, 'revenue'),
  };
}

export async function cogs(ctx: MetricContext): Promise<MetricResult> {
  const { minorUnits, count } = await sumStatement(ctx, 'cogs');
  return {
    key: 'cogs',
    label: 'Cost of Goods Sold',
    value: minorUnits,
    unit: 'currency',
    money: money(minorUnits),
    period: ctx.period,
    confidence: count === 0 ? 'insufficient_data' : 'high',
    provenance: provenance('cogs', count, ctx.period, 'cogs'),
  };
}

export async function grossMargin(ctx: MetricContext): Promise<MetricResult> {
  const [rev, cost] = await Promise.all([revenue(ctx), cogs(ctx)]);
  const revenueMinor = rev.value ?? 0;

  // Division by zero produces Infinity, which renders as a plausible-looking
  // number somewhere downstream. Refusing is the correct behaviour.
  if (revenueMinor === 0) {
    return {
      key: 'gross_margin',
      label: 'Gross margin',
      value: null,
      unit: 'percent',
      period: ctx.period,
      confidence: 'insufficient_data',
      reason: 'No revenue in this period, so margin is undefined',
      provenance: provenance('gross_margin', 0, ctx.period),
    };
  }

  const ratio = (revenueMinor - (cost.value ?? 0)) / revenueMinor;
  return {
    key: 'gross_margin',
    label: 'Gross margin',
    value: Math.round(ratio * 10000) / 100,
    unit: 'percent',
    period: ctx.period,
    confidence: rev.confidence === 'high' ? 'high' : 'medium',
    provenance: provenance(
      'gross_margin',
      rev.provenance.sourceRecordCount + cost.provenance.sourceRecordCount,
      ctx.period,
    ),
  };
}

export async function operatingExpenses(ctx: MetricContext): Promise<MetricResult> {
  const [opex, payroll] = await Promise.all([
    sumStatement(ctx, 'opex'),
    sumStatement(ctx, 'payroll'),
  ]);
  const total = opex.minorUnits + payroll.minorUnits;
  return {
    key: 'operating_expenses',
    label: 'Operating expenses',
    value: total,
    unit: 'currency',
    money: money(total),
    period: ctx.period,
    confidence: opex.count + payroll.count === 0 ? 'insufficient_data' : 'high',
    provenance: provenance('operating_expenses', opex.count + payroll.count, ctx.period),
  };
}

export async function netProfit(ctx: MetricContext): Promise<MetricResult> {
  const [rev, cost, opex] = await Promise.all([revenue(ctx), cogs(ctx), operatingExpenses(ctx)]);
  const value = (rev.value ?? 0) - (cost.value ?? 0) - (opex.value ?? 0);
  return {
    key: 'net_profit',
    label: 'Net profit',
    value,
    unit: 'currency',
    money: money(value),
    period: ctx.period,
    confidence: rev.confidence === 'insufficient_data' ? 'insufficient_data' : 'high',
    provenance: provenance('net_profit', rev.provenance.sourceRecordCount, ctx.period),
  };
}

/**
 * Cash position.
 *
 * Reconstructed from settled cash movement (posted_at), not from accrual
 * activity. Invoices are excluded by construction — an invoice is a promise, not
 * money in the bank, and conflating the two is precisely why profitable
 * businesses run out of cash.
 */
export async function cashPosition(ctx: MetricContext): Promise<MetricResult> {
  const rows = await scoped<{ net: string; n: string }>(
    ctx,
    `SELECT coalesce(sum(CASE WHEN direction = 'inflow' THEN amount ELSE -amount END), 0) AS net,
            count(*) AS n
       FROM transactions
      WHERE posted_at IS NOT NULL AND posted_at <= $1
        AND is_canonical AND NOT is_transfer AND voided_at IS NULL`,
    [ctx.period.end],
  );
  const row = rows[0];
  const netMinor = Money.fromDecimalString(row?.net ?? '0', 'USD').minorUnits;
  const count = Number(row?.n ?? 0);

  return {
    key: 'cash_position',
    label: 'Cash',
    value: netMinor,
    unit: 'currency',
    money: money(netMinor),
    period: ctx.period,
    confidence: count === 0 ? 'insufficient_data' : 'high',
    provenance: provenance('cash_position', count, ctx.period),
  };
}

/** Average monthly cash burn over the trailing 6 months. */
export async function monthlyBurn(ctx: MetricContext): Promise<MetricResult> {
  const rows = await scoped<{ month: string; net: string }>(
    ctx,
    `SELECT date_trunc('month', posted_at)::date AS month,
            sum(CASE WHEN direction = 'inflow' THEN amount ELSE -amount END) AS net
       FROM transactions
      WHERE posted_at IS NOT NULL
        AND posted_at > ($1::date - INTERVAL '6 months')
        AND posted_at <= $1::date
        AND is_canonical AND NOT is_transfer AND voided_at IS NULL
      GROUP BY 1 ORDER BY 1`,
    [ctx.period.end],
  );

  if (rows.length < 2) {
    return {
      key: 'monthly_burn',
      label: 'Monthly burn',
      value: null,
      unit: 'currency',
      period: ctx.period,
      confidence: 'insufficient_data',
      reason: 'Needs at least two months of settled cash activity',
      provenance: provenance('monthly_burn', rows.length, ctx.period),
    };
  }

  const nets = rows.map((r) => Money.fromDecimalString(r.net, 'USD').minorUnits);
  const avg = Math.round(nets.reduce((s, v) => s + v, 0) / nets.length);
  // Burn is a positive number describing money leaving. A cash-generative
  // business has zero burn, not negative burn.
  const burn = avg < 0 ? -avg : 0;

  return {
    key: 'monthly_burn',
    label: 'Monthly burn',
    value: burn,
    unit: 'currency',
    money: money(burn),
    period: ctx.period,
    confidence: rows.length >= 4 ? 'high' : 'medium',
    ...(rows.length < 4 ? { reason: `Only ${rows.length} months of history` } : {}),
    provenance: provenance('monthly_burn', rows.length, ctx.period),
  };
}

export async function runway(ctx: MetricContext): Promise<MetricResult> {
  const [cash, burn] = await Promise.all([cashPosition(ctx), monthlyBurn(ctx)]);

  if (burn.value === null) {
    return {
      key: 'runway_months',
      label: 'Runway',
      value: null,
      unit: 'months',
      period: ctx.period,
      confidence: 'insufficient_data',
      reason: burn.reason ?? 'Burn rate unavailable',
      provenance: provenance('runway_months', 0, ctx.period),
    };
  }

  // A profitable business has no runway limit, and reporting a huge number here
  // would be misleading. Saying so explicitly is more useful than "999 months".
  if (burn.value === 0) {
    return {
      key: 'runway_months',
      label: 'Runway',
      value: null,
      unit: 'months',
      period: ctx.period,
      confidence: 'high',
      reason: 'Cash-flow positive over the trailing 6 months — no runway limit',
      provenance: provenance('runway_months', 0, ctx.period),
    };
  }

  return {
    key: 'runway_months',
    label: 'Runway',
    value: Math.round(((cash.value ?? 0) / burn.value) * 10) / 10,
    unit: 'months',
    period: ctx.period,
    confidence: burn.confidence,
    provenance: provenance('runway_months', 0, ctx.period),
  };
}

// ── Breakdowns ───────────────────────────────────────────────────────────────

export interface BreakdownRow {
  readonly label: string;
  readonly value: number;
  readonly money: { amount: string; currency: string; minorUnits: number };
  readonly share: number;
  readonly count: number;
}

export async function expensesByCategory(ctx: MetricContext): Promise<BreakdownRow[]> {
  const rows = await scoped<{ label: string; total: string; n: string }>(
    ctx,
    `SELECT coalesce(c.name, 'Uncategorized') AS label,
            sum(t.amount) AS total, count(*) AS n
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.statement IN ('opex','cogs','payroll')
        AND t.occurred_at >= $1 AND t.occurred_at <= $2
        AND t.is_canonical AND NOT t.is_transfer AND t.voided_at IS NULL
      GROUP BY 1 ORDER BY sum(t.amount) DESC`,
    [ctx.period.start, ctx.period.end],
  );

  const totals = rows.map((r) => Money.fromDecimalString(r.total, 'USD').minorUnits);
  const grand = totals.reduce((s, v) => s + v, 0);

  return rows.map((r, i) => {
    const minorUnits = totals[i] ?? 0;
    return {
      label: r.label,
      value: minorUnits,
      money: money(minorUnits),
      share: grand > 0 ? minorUnits / grand : 0,
      count: Number(r.n),
    };
  });
}

export async function revenueByCustomer(ctx: MetricContext): Promise<BreakdownRow[]> {
  const rows = await scoped<{ label: string; total: string; n: string }>(
    ctx,
    `SELECT coalesce(cu.name, 'Unattributed') AS label,
            sum(t.amount) AS total, count(*) AS n
       FROM transactions t
       LEFT JOIN customers cu ON cu.id = t.customer_id
      WHERE t.statement = 'revenue'
        AND t.occurred_at >= $1 AND t.occurred_at <= $2
        AND t.is_canonical AND NOT t.is_transfer AND t.voided_at IS NULL
      GROUP BY 1 ORDER BY sum(t.amount) DESC`,
    [ctx.period.start, ctx.period.end],
  );

  const totals = rows.map((r) => Money.fromDecimalString(r.total, 'USD').minorUnits);
  const grand = totals.reduce((s, v) => s + v, 0);

  return rows.map((r, i) => {
    const minorUnits = totals[i] ?? 0;
    return {
      label: r.label,
      value: minorUnits,
      money: money(minorUnits),
      share: grand > 0 ? minorUnits / grand : 0,
      count: Number(r.n),
    };
  });
}

export interface MonthlySeriesPoint {
  readonly month: string;
  readonly revenue: number;
  readonly cogs: number;
  readonly opex: number;
  readonly profit: number;
  readonly grossMarginPct: number | null;
}

export async function monthlySeries(
  ctx: MetricContext,
  monthsBack = 24,
): Promise<MonthlySeriesPoint[]> {
  const rows = await scoped<{
    month: string; revenue: string; cogs: string; opex: string;
  }>(
    ctx,
    `SELECT to_char(date_trunc('month', occurred_at), 'YYYY-MM') AS month,
            coalesce(sum(amount) FILTER (WHERE statement = 'revenue'), 0) AS revenue,
            coalesce(sum(amount) FILTER (WHERE statement = 'cogs'), 0) AS cogs,
            coalesce(sum(amount) FILTER (WHERE statement IN ('opex','payroll')), 0) AS opex
       FROM transactions
      WHERE occurred_at > ($1::date - ($2 || ' months')::interval)
        AND occurred_at <= $1::date
        AND is_canonical AND NOT is_transfer AND voided_at IS NULL
      GROUP BY 1 ORDER BY 1`,
    [ctx.period.end, String(monthsBack)],
  );

  return rows.map((r) => {
    const rev = Money.fromDecimalString(r.revenue, 'USD').minorUnits;
    const cost = Money.fromDecimalString(r.cogs, 'USD').minorUnits;
    const op = Money.fromDecimalString(r.opex, 'USD').minorUnits;
    return {
      month: r.month,
      revenue: rev,
      cogs: cost,
      opex: op,
      profit: rev - cost - op,
      grossMarginPct: rev > 0 ? Math.round(((rev - cost) / rev) * 10000) / 100 : null,
    };
  });
}

export interface ArAgingBucket {
  readonly bucket: string;
  readonly minorUnits: number;
  readonly count: number;
}

export async function arAging(ctx: MetricContext): Promise<ArAgingBucket[]> {
  const rows = await scoped<{ bucket: string; total: string; n: string }>(
    ctx,
    `SELECT CASE
              WHEN due_date >= $1::date THEN 'Current'
              WHEN due_date >= $1::date - 30 THEN '1-30 days'
              WHEN due_date >= $1::date - 60 THEN '31-60 days'
              WHEN due_date >= $1::date - 90 THEN '61-90 days'
              ELSE '90+ days'
            END AS bucket,
            sum(balance) AS total, count(*) AS n
       FROM invoices
      WHERE status IN ('open','partial','overdue') AND voided_at IS NULL
      GROUP BY 1`,
    [ctx.period.end],
  );

  const order = ['Current', '1-30 days', '31-60 days', '61-90 days', '90+ days'];
  return rows
    .map((r) => ({
      bucket: r.bucket,
      minorUnits: Money.fromDecimalString(r.total, 'USD').minorUnits,
      count: Number(r.n),
    }))
    .sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
}

/**
 * Decomposition: what drove the change between two periods.
 *
 * This is the computation behind "why did profit drop?" — the question that most
 * clearly separates an answer from a dashboard. A chart shows the symptom; this
 * ranks the causes.
 */
export interface Driver {
  readonly label: string;
  readonly currentMinor: number;
  readonly priorMinor: number;
  readonly deltaMinor: number;
  readonly shareOfChange: number;
}

export async function decomposeExpenseChange(
  ctx: MetricContext,
  prior: Period,
): Promise<Driver[]> {
  const rows = await scoped<{ label: string; current: string; prior: string }>(
    ctx,
    `WITH cur AS (
       SELECT coalesce(c.name, 'Uncategorized') AS label, sum(t.amount) AS total
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.statement IN ('opex','cogs','payroll')
          AND t.occurred_at >= $1 AND t.occurred_at <= $2
          AND t.is_canonical AND NOT t.is_transfer AND t.voided_at IS NULL
        GROUP BY 1),
     pri AS (
       SELECT coalesce(c.name, 'Uncategorized') AS label, sum(t.amount) AS total
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.statement IN ('opex','cogs','payroll')
          AND t.occurred_at >= $3 AND t.occurred_at <= $4
          AND t.is_canonical AND NOT t.is_transfer AND t.voided_at IS NULL
        GROUP BY 1)
     SELECT coalesce(cur.label, pri.label) AS label,
            coalesce(cur.total, 0) AS current,
            coalesce(pri.total, 0) AS prior
       FROM cur FULL OUTER JOIN pri ON cur.label = pri.label`,
    [ctx.period.start, ctx.period.end, prior.start, prior.end],
  );

  const drivers = rows.map((r) => {
    const current = Money.fromDecimalString(r.current, 'USD').minorUnits;
    const priorMinor = Money.fromDecimalString(r.prior, 'USD').minorUnits;
    return { label: r.label, currentMinor: current, priorMinor, deltaMinor: current - priorMinor };
  });

  // Share is computed against the total absolute movement, so a category that
  // moved against the trend doesn't produce a nonsensical share above 100%.
  const totalAbs = drivers.reduce((s, d) => s + Math.abs(d.deltaMinor), 0);

  return drivers
    .map((d) => ({ ...d, shareOfChange: totalAbs > 0 ? Math.abs(d.deltaMinor) / totalAbs : 0 }))
    .sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor));
}

// ── Period helpers ───────────────────────────────────────────────────────────

export function monthPeriod(year: number, month: number): Period {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    grain: 'month',
  };
}

export function trailingMonths(asOf: Date, months: number): Period {
  const start = new Date(asOf);
  start.setMonth(start.getMonth() - months);
  return {
    start: start.toISOString().slice(0, 10),
    end: asOf.toISOString().slice(0, 10),
    grain: months === 12 ? 'trailing_12' : 'custom',
  };
}
