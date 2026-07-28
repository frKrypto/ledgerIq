import type { Pool } from 'pg';
import { createPool, connectionStringFromEnv } from '@ledgeriq/db';
import {
  arAging,
  buildCashForecast,
  cashPosition,
  decomposeExpenseChange,
  expensesByCategory,
  grossMargin,
  monthlyBurn,
  monthlySeries,
  netProfit,
  operatingExpenses,
  revenue,
  revenueByCustomer,
  runway,
  trailingMonths,
  monthPeriod,
  type MetricContext,
  type Period,
} from '@ledgeriq/metrics';

/**
 * The dashboard payload and the drill-down query, extracted so the live server
 * and the static export produce byte-identical data. If these diverged, the
 * shareable snapshot would stop being evidence about the real product — which
 * is the only reason to ship a snapshot at all.
 */

export interface Org {
  readonly id: string;
  readonly name: string;
}

export interface DrilldownRow {
  readonly date: string;
  readonly description: string | null;
  readonly merchant_name: string | null;
  readonly amount: string;
  readonly direction: string;
  readonly category: string;
}

/**
 * Organization lookup happens *before* a tenant scope exists, so it cannot use
 * the RLS-enforced app pool — that pool correctly returns zero rows when
 * `app.current_org_id` is unset. This is the one query that legitimately runs
 * unscoped, and it reads nothing but the org's own id and name.
 */
export async function resolveOrg(name?: string): Promise<Org | null> {
  const adminPool = createPool({
    connectionString: process.env['ADMIN_DATABASE_URL'] ?? connectionStringFromEnv(),
    applicationName: 'ledgeriq-web-admin',
    maxConnections: 2,
  });
  try {
    const { rows } = await adminPool.query<Org>(
      name
        ? `SELECT id, name FROM organizations WHERE name = $1 AND deleted_at IS NULL LIMIT 1`
        : `SELECT id, name FROM organizations WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      name ? [name] : [],
    );
    return rows[0] ?? null;
  } finally {
    await adminPool.end();
  }
}

/** Everything the dashboard needs, in one round trip. */
export async function buildDashboard(
  pool: Pool,
  org: Org,
  asOf: Date = new Date(),
): Promise<Record<string, unknown>> {
  const ttm = trailingMonths(asOf, 12);
  const thisMonth = monthPeriod(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1);
  const priorMonth = monthPeriod(
    asOf.getUTCMonth() === 0 ? asOf.getUTCFullYear() - 1 : asOf.getUTCFullYear(),
    asOf.getUTCMonth() === 0 ? 12 : asOf.getUTCMonth(),
  );

  const orgId = org.id;
  const ttmCtx: MetricContext = { pool, orgId, period: ttm };
  const monthCtx: MetricContext = { pool, orgId, period: thisMonth };

  // Rolling 30-day windows for the change comparison.
  //
  // Comparing month-to-date against a FULL prior month is not a comparison — on
  // the 28th it makes every expense category look like it collapsed, and the
  // first render of this page showed wages "down $63,633" purely because the
  // month wasn't over. Equal-length windows are the only honest version.
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const daysAgo = (n: number): Date => new Date(asOf.getTime() - n * 86400000);
  const last30: Period = { start: iso(daysAgo(30)), end: iso(asOf), grain: 'custom' };
  const prior30: Period = { start: iso(daysAgo(60)), end: iso(daysAgo(31)), grain: 'custom' };

  const [
    cash, run, ttmRevenue, ttmProfit, ttmOpex,
    marginNow, marginPrior, series, byCategory, byCustomer, aging, burn,
    drivers, forecast,
  ] = await Promise.all([
    cashPosition(ttmCtx),
    runway(ttmCtx),
    revenue(ttmCtx),
    netProfit(ttmCtx),
    operatingExpenses(ttmCtx),
    grossMargin(monthCtx),
    grossMargin({ pool, orgId, period: priorMonth }),
    monthlySeries(ttmCtx, 24),
    expensesByCategory(ttmCtx),
    revenueByCustomer(ttmCtx),
    arAging(ttmCtx),
    monthlyBurn(ttmCtx),
    decomposeExpenseChange({ pool, orgId, period: last30 }, prior30),
    buildCashForecast(pool, orgId, { asOf }),
  ]);

  // Revenue concentration — the top customer's share. A genuine risk signal for
  // an agency, and computed rather than asserted.
  const topCustomer = byCustomer[0];

  return {
    org: { id: orgId, name: org.name },
    asOf: asOf.toISOString(),
    metrics: {
      cash, runway: run, revenue: ttmRevenue, profit: ttmProfit,
      opex: ttmOpex, margin: marginNow, marginPrior, burn,
    },
    series,
    breakdowns: { byCategory, byCustomer, aging },
    concentration: topCustomer
      ? { customer: topCustomer.label, share: topCustomer.share }
      : null,
    drivers: drivers.slice(0, 6),
    forecast,
  };
}

/**
 * The transactions behind a figure. This is the interaction that makes a number
 * trustworthy (prd.md principle 1) — every figure on the page resolves here.
 */
export async function drilldown(
  pool: Pool,
  orgId: string,
  opts: { statement?: string | null | undefined; from?: string | undefined; to?: string | undefined },
): Promise<DrilldownRow[]> {
  const from = opts.from ?? '1900-01-01';
  const to = opts.to ?? '2999-12-31';
  const statement = opts.statement ?? null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1,$2,true)', ['app.current_org_id', orgId]);
    const { rows } = await client.query<DrilldownRow>(
      `SELECT t.occurred_at::text AS date, t.description, t.merchant_name,
              t.amount::text AS amount, t.direction,
              coalesce(c.name,'Uncategorized') AS category
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.occurred_at >= $1 AND t.occurred_at <= $2
          ${statement ? 'AND t.statement = $3::statement_class' : ''}
          AND t.is_canonical AND NOT t.is_transfer AND t.voided_at IS NULL
        ORDER BY t.amount DESC LIMIT 100`,
      statement ? [from, to, statement] : [from, to],
    );
    await client.query('COMMIT');
    return rows;
  } finally {
    client.release();
  }
}

/**
 * The drill-downs the dashboard's four tiles can request, keyed exactly as
 * `app.html` keys them. The static export pre-computes this set; the live server
 * ignores it and queries on demand. Keeping the key format in one place is what
 * stops the export from silently shipping dead click targets.
 */
export function drilldownKey(statement: string, from: string, to: string): string {
  return `${statement}|${from}|${to}`;
}

export function tileDrilldowns(
  dashboard: Record<string, unknown>,
): Array<{ key: string; statement: string; from: string; to: string }> {
  const metrics = (dashboard as { metrics: Record<string, { period: Period }> }).metrics;
  const pairs: Array<[string, string]> = [
    ['cash', 'asset'],
    ['revenue', 'revenue'],
    ['margin', 'cogs'],
  ];
  return pairs.flatMap(([metric, statement]) => {
    const period = metrics[metric]?.period;
    if (!period) return [];
    return [{ key: drilldownKey(statement, period.start, period.end), statement, from: period.start, to: period.end }];
  });
}
