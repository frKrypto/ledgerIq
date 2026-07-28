import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, connectionStringFromEnv, assertRoleCannotBypassRls } from '@ledgeriq/db';
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
 * Demo web server.
 *
 * Deliberately a plain Node HTTP server rather than Next.js. The point of this
 * app is to prove the metric engine produces correct numbers and that the design
 * renders them — not to litigate a frontend framework. Next.js arrives with the
 * real onboarding flow in sprint 7; standing it up now would add a build step
 * and a dependency tree in exchange for nothing this app needs.
 *
 * Every figure served here is computed by @ledgeriq/metrics from rows that came
 * through the real ingestion pipeline. Nothing on this page is hardcoded.
 */

const PORT = Number(process.env['WEB_PORT'] ?? 4100);
const HERE = dirname(fileURLToPath(import.meta.url));

const pool = createPool({
  connectionString: connectionStringFromEnv(),
  applicationName: 'ledgeriq-web',
  maxConnections: 8,
});

// Same startup guarantee as the API: refuse to serve if the connected role can
// bypass row-level security.
await assertRoleCannotBypassRls(pool);

async function resolveOrg(name?: string): Promise<{ id: string; name: string } | null> {
  const adminPool = createPool({
    connectionString: process.env['ADMIN_DATABASE_URL'] ?? connectionStringFromEnv(),
    applicationName: 'ledgeriq-web-admin',
    maxConnections: 2,
  });
  try {
    const { rows } = await adminPool.query<{ id: string; name: string }>(
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
async function buildDashboard(orgId: string, orgName: string): Promise<unknown> {
  const asOf = new Date();
  const ttm = trailingMonths(asOf, 12);
  const thisMonth = monthPeriod(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1);
  const priorMonth = monthPeriod(
    asOf.getUTCMonth() === 0 ? asOf.getUTCFullYear() - 1 : asOf.getUTCFullYear(),
    asOf.getUTCMonth() === 0 ? 12 : asOf.getUTCMonth(),
  );

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
    org: { id: orgId, name: orgName },
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

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    try {
      if (url.pathname === '/api/dashboard') {
        const org = await resolveOrg(url.searchParams.get('org') ?? undefined);
        if (!org) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'No organization found. Run `npm run demo` first.' }));
          return;
        }
        const data = await buildDashboard(org.id, org.name);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
      }

      // Drill-down: the transactions behind a figure. This is the interaction
      // that makes a number trustworthy (prd.md principle 1) — every figure on
      // the page resolves here.
      if (url.pathname === '/api/drilldown') {
        const org = await resolveOrg(url.searchParams.get('org') ?? undefined);
        if (!org) {
          res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
          return;
        }
        const statement = url.searchParams.get('statement');
        const from = url.searchParams.get('from') ?? '1900-01-01';
        const to = url.searchParams.get('to') ?? '2999-12-31';

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT set_config($1,$2,true)', ['app.current_org_id', org.id]);
          const { rows } = await client.query(
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
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ rows }));
        } finally {
          client.release();
        }
        return;
      }

      if (url.pathname === '/favicon.ico') {
        // Inline SVG: the ledger rule resolving into a rising line, per the
        // brand mark. Avoids a 404 on every page load.
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' });
        res.end(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
             <path d="M3 17h7" stroke="#4e5459" stroke-width="2.4" stroke-linecap="round"/>
             <path d="M10 17c4 0 5-3.2 7-6.4S20.4 5 21 4.6" stroke="#0f8a6a" stroke-width="2.4"
                   stroke-linecap="round"/>
             <circle cx="21" cy="4.6" r="2" fill="#0f8a6a"/></svg>`,
        );
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(join(HERE, 'app.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  })();
});

server.listen(PORT, () => {
  console.log(`\n  LedgerIQ  →  http://localhost:${PORT}\n`);
});
