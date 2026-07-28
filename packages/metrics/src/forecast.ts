import type { Pool } from 'pg';
import * as Money from '@ledgeriq/core/money';

/**
 * 13-week cash forecast.
 *
 * The wedge (prd.md §2.1). Everything else in the product is downstream of being
 * able to say, three weeks early and correctly: "you will be short for the
 * Nov 15 payroll."
 *
 * Structural rather than learned, per prd.md §5.2. Four streams, each projected
 * by the method that actually fits it:
 *
 *   committed    Payroll, rent, loans, scheduled recurring. Deterministic — this
 *                is most of the signal and needs no model at all.
 *   receivables  Open invoices, timed by each customer's OBSERVED payment
 *                behaviour rather than by the invoice due date. This single
 *                choice is the largest accuracy driver, and projecting from due
 *                dates is what makes naive forecasts useless.
 *   variable     Discretionary spend, from trailing seasonal behaviour.
 *   newRevenue   Not yet invoiced. Widest band; the largest uncertainty
 *                contributor.
 *
 * A learned end-to-end model would be worse here: unexplainable, cold-start
 * broken, and impossible to debug when a customer disputes a number.
 */

export const FORECAST_VERSION = '2026.07.1';

export interface ForecastPoint {
  readonly date: string;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly committed: number;
  readonly receivables: number;
  readonly variable: number;
}

export type RiskKind =
  | 'payroll_shortfall' | 'cash_shortfall' | 'large_expense_due' | 'runway_threshold';

export interface RiskEvent {
  readonly kind: RiskKind;
  readonly severity: 'critical' | 'high' | 'medium' | 'info';
  readonly date: string;
  readonly headline: string;
  readonly shortfallMinor: number;
  readonly daysAway: number;
  readonly drivers: string[];
  readonly actions: Array<{ text: string; impactMinor: number; type: string }>;
}

export interface Assumption {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly description: string;
  readonly source: 'engine_default' | 'org_history' | 'industry_prior';
}

export interface Forecast {
  readonly generatedAt: string;
  readonly horizonDays: number;
  readonly startingCashMinor: number;
  readonly points: ForecastPoint[];
  readonly riskEvents: RiskEvent[];
  readonly assumptions: Assumption[];
  readonly confidence: 'high' | 'medium' | 'low' | 'insufficient_data';
  readonly historyDays: number;
  readonly methodVersion: string;
}

async function scoped<T>(pool: Pool, orgId: string, sql: string, params: unknown[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', orgId]);
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

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000);

export async function buildCashForecast(
  pool: Pool,
  orgId: string,
  opts: { asOf?: Date; horizonDays?: number } = {},
): Promise<Forecast> {
  const asOf = opts.asOf ?? new Date();
  const horizonDays = opts.horizonDays ?? 91;
  const asOfKey = dayKey(asOf);

  // ── Starting position: settled cash only ─────────────────────────────────
  const cashRows = await scoped<{ net: string }>(
    pool, orgId,
    `SELECT coalesce(sum(CASE WHEN direction='inflow' THEN amount ELSE -amount END), 0) AS net
       FROM transactions
      WHERE posted_at IS NOT NULL AND posted_at <= $1
        AND is_canonical AND NOT is_transfer AND voided_at IS NULL`,
    [asOfKey],
  );
  const startingCash: number = Money.fromDecimalString(cashRows[0]?.net ?? '0', 'USD').minorUnits;

  const historyRows = await scoped<{ span: string | null }>(
    pool, orgId,
    `SELECT (max(occurred_at) - min(occurred_at))::text AS span FROM transactions
      WHERE is_canonical AND voided_at IS NULL`,
    [],
  );
  const historyDays = Number(historyRows[0]?.span ?? 0);

  // ── Stream 1: committed payroll ──────────────────────────────────────────
  // Projected from observed cadence rather than requiring a payroll connector.
  // This is what lets payroll-risk detection work on day one with only
  // accounting data — the wedge cannot wait for a Gusto integration.
  const payrollRows = await scoped<{ pay_date: string; total: string }>(
    pool, orgId,
    `SELECT occurred_at::text AS pay_date, sum(amount) AS total
       FROM transactions
      WHERE statement = 'payroll'
        AND occurred_at > ($1::date - INTERVAL '4 months') AND occurred_at <= $1::date
        AND is_canonical AND voided_at IS NULL
      GROUP BY 1 ORDER BY 1`,
    [asOfKey],
  );

  const payrollHistory = payrollRows.map((r) => ({
    date: new Date(r.pay_date),
    minorUnits: Money.fromDecimalString(r.total, 'USD').minorUnits,
  }));

  const projectedPayroll = projectPayroll(payrollHistory, asOf, horizonDays);

  // ── Stream 1b: committed recurring vendors ───────────────────────────────
  const recurringRows = await scoped<{ merchant: string; monthly: string; day_of_month: string }>(
    pool, orgId,
    `SELECT merchant_name AS merchant,
            avg(amount) AS monthly,
            round(avg(extract(day from occurred_at))) AS day_of_month
       FROM transactions
      WHERE merchant_name IS NOT NULL AND direction = 'outflow'
        AND statement IN ('opex','cogs')
        AND occurred_at > ($1::date - INTERVAL '4 months') AND occurred_at <= $1::date
        AND is_canonical AND NOT is_transfer AND voided_at IS NULL
      GROUP BY merchant_name
     HAVING count(*) >= 3`,
    [asOfKey],
  );

  // ── Stream 2: receivables, timed by observed behaviour ───────────────────
  const invoiceRows = await scoped<{
    balance: string; due_date: string | null; customer: string | null;
    mean_days_late: string | null; sample_count: string | null;
  }>(
    pool, orgId,
    `SELECT i.balance::text AS balance, i.due_date::text AS due_date, cu.name AS customer,
            (cu.payment_behavior->>'meanDaysLate') AS mean_days_late,
            (cu.payment_behavior->>'sampleCount') AS sample_count
       FROM invoices i LEFT JOIN customers cu ON cu.id = i.customer_id
      WHERE i.status IN ('open','partial','overdue') AND i.voided_at IS NULL
        AND i.balance > 0`,
    [],
  );

  const receivables = invoiceRows.map((r) => {
    const balance = Money.fromDecimalString(r.balance, 'USD').minorUnits;
    const due = r.due_date ? new Date(r.due_date) : asOf;
    const sampleCount = Number(r.sample_count ?? 0);
    // Fall back to an industry prior when a customer has too little history.
    // Assuming on-time payment would be optimistic in a way that hides risk.
    const meanLate = sampleCount >= 4 ? Number(r.mean_days_late ?? 0) : 14;
    const expected = addDays(due, Math.round(meanLate));
    return {
      balance,
      // An invoice already past its expected date lands soon rather than in the
      // past — money doesn't arrive retroactively.
      expectedDate: expected < asOf ? addDays(asOf, 5) : expected,
      customer: r.customer ?? 'Unknown',
      confident: sampleCount >= 4,
    };
  });

  // ── Stream 3: variable spend, trailing daily average ─────────────────────
  const variableRows = await scoped<{ daily: string }>(
    pool, orgId,
    `SELECT coalesce(sum(amount) / 90.0, 0) AS daily
       FROM transactions
      WHERE direction = 'outflow' AND statement IN ('opex','cogs')
        AND merchant_name IS NULL
        AND occurred_at > ($1::date - INTERVAL '90 days') AND occurred_at <= $1::date
        AND is_canonical AND NOT is_transfer AND voided_at IS NULL`,
    [asOfKey],
  );
  // An average has sub-cent precision by construction. fromDecimalString
  // deliberately refuses to truncate that silently, so the rounding is stated
  // explicitly here rather than hidden in a parser.
  const dailyVariable: number = Money.roundToMinorUnits(
    String(Number(variableRows[0]?.daily ?? 0)), 'USD',
  ).minorUnits;

  // ── Stream 4: new revenue not yet invoiced ───────────────────────────────
  //
  // Omitting this entirely (the first implementation) makes the forecast assume
  // the business signs nothing for a full quarter, which for a retainer-based
  // agency is not conservative — it is wrong. It produced four spurious payroll
  // shortfalls on a healthy business, which is exactly the false-positive
  // pattern the alert budget exists to prevent (prd.md §5.4).
  //
  // Projected from trailing invoicing behaviour and collected on the fleet's
  // average payment lag. Deliberately discounted, because pipeline is not
  // revenue: only 80% of the trailing run-rate is assumed.
  const newRevenueRows = await scoped<{ monthly: string; lag: string }>(
    pool, orgId,
    `SELECT coalesce(sum(total) / 6.0, 0) AS monthly,
            coalesce(avg(CASE WHEN paid_on IS NOT NULL AND due_date IS NOT NULL
                              THEN (paid_on - due_date) END), 14) AS lag
       FROM invoices
      WHERE issued_on > ($1::date - INTERVAL '6 months') AND issued_on <= $1::date
        AND voided_at IS NULL`,
    [asOfKey],
  );
  const monthlyNewRevenue = Money.roundToMinorUnits(
    String(Number(newRevenueRows[0]?.monthly ?? 0) * 0.8), 'USD',
  ).minorUnits;
  const collectionLagDays = Math.round(Number(newRevenueRows[0]?.lag ?? 14)) + 30;

  // ── Compose ──────────────────────────────────────────────────────────────
  const points: ForecastPoint[] = [];
  // Plain numbers, not MinorUnits: the branded type deliberately resists
  // arithmetic so that a raw number can't be mistaken for a checked amount.
  // These are running totals in minor units, converted at the boundary.
  let balance: number = startingCash;
  let committedCumulative = 0;
  let receivablesCumulative = 0;
  let variableCumulative = 0;

  for (let i = 1; i <= horizonDays; i++) {
    const date = addDays(asOf, i);
    const key = dayKey(date);
    let dayDelta = 0;

    for (const run of projectedPayroll) {
      if (dayKey(run.date) === key) {
        dayDelta -= run.minorUnits;
        committedCumulative -= run.minorUnits;
      }
    }

    for (const vendor of recurringRows) {
      if (date.getUTCDate() === Number(vendor.day_of_month)) {
        const amount = Money.roundToMinorUnits(String(Number(vendor.monthly)), 'USD').minorUnits;
        dayDelta -= amount;
        committedCumulative -= amount;
      }
    }

    for (const invoice of receivables) {
      if (dayKey(invoice.expectedDate) === key) {
        dayDelta += invoice.balance;
        receivablesCumulative += invoice.balance;
      }
    }

    // New revenue lands once a month, offset by the typical collection lag, so
    // it appears as cash when it would actually arrive rather than when it is
    // billed.
    if (date.getUTCDate() === 1 && i > collectionLagDays) {
      dayDelta += monthlyNewRevenue;
      receivablesCumulative += monthlyNewRevenue;
    }

    dayDelta -= dailyVariable;
    variableCumulative -= dailyVariable;
    balance += dayDelta;

    // Uncertainty widens with horizon — sqrt(t), the standard diffusion shape.
    // A constant band would understate far-dated risk and overstate near-dated
    // certainty, which is exactly backwards for a payroll warning.
    const spread = Math.round(Math.sqrt(i) * Math.abs(dailyVariable) * 2.6 + i * 180_00);

    points.push({
      date: key,
      p50: balance,
      p10: balance - spread,
      p90: balance + Math.round(spread * 0.85),
      committed: committedCumulative,
      receivables: receivablesCumulative,
      variable: variableCumulative,
    });
  }

  const riskEvents = detectRisks(points, projectedPayroll, receivables, asOf, startingCash);

  const assumptions: Assumption[] = [
    {
      key: 'ar_timing_from_history',
      label: 'Receivable timing',
      value: receivables.some((r) => r.confident) ? 'per-customer history' : '14 days late (prior)',
      description:
        'Open invoices are timed by each customer’s observed payment behaviour, not by the invoice due date.',
      source: receivables.some((r) => r.confident) ? 'org_history' : 'industry_prior',
    },
    {
      key: 'payroll_cadence',
      label: 'Payroll cadence',
      value: projectedPayroll.length > 0 ? 'projected from history' : 'none detected',
      description: 'Upcoming payroll runs are projected from the observed cadence and amount.',
      source: 'org_history',
    },
    {
      key: 'new_revenue',
      label: 'New revenue',
      value: `${Money.format(Money.money(monthlyNewRevenue, 'USD'))}/mo`,
      description:
        'Projected at 80% of the trailing 6-month invoicing run-rate, collected after the typical payment lag. Deliberately discounted — pipeline is not revenue.',
      source: 'org_history',
    },
  ];

  const confidence: Forecast['confidence'] =
    historyDays < 90 ? 'low' : historyDays < 365 ? 'medium' : 'high';

  return {
    generatedAt: new Date().toISOString(),
    horizonDays,
    startingCashMinor: startingCash,
    points,
    riskEvents,
    assumptions,
    confidence,
    historyDays,
    methodVersion: FORECAST_VERSION,
  };
}

/** Project future payroll from observed cadence. */
function projectPayroll(
  history: Array<{ date: Date; minorUnits: number }>,
  asOf: Date,
  horizonDays: number,
): Array<{ date: Date; minorUnits: number }> {
  if (history.length < 2) return [];

  const gaps: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    if (!prev || !cur) continue;
    gaps.push((cur.date.getTime() - prev.date.getTime()) / 86400000);
  }
  if (gaps.length === 0) return [];

  gaps.sort((a, b) => a - b);
  // Median, not mean: one irregular gap (a bonus run, a correction) would drag
  // the mean and desynchronise every projected date after it.
  const cadence = Math.round(gaps[Math.floor(gaps.length / 2)] ?? 14);
  if (cadence < 5 || cadence > 40) return [];

  const recent = history.slice(-6);
  const typical = Math.round(recent.reduce((s, r) => s + r.minorUnits, 0) / recent.length);
  const last = history[history.length - 1];
  if (!last) return [];

  const projected: Array<{ date: Date; minorUnits: number }> = [];
  let next = addDays(last.date, cadence);
  while (next <= addDays(asOf, horizonDays)) {
    if (next > asOf) projected.push({ date: next, minorUnits: typical });
    next = addDays(next, cadence);
  }
  return projected;
}

/**
 * Detect named risk events.
 *
 * Risks are objects on a timeline, not a dip in a curve. A user needs to know
 * *what* is at risk and *what to do*, and "the line goes down around here" is
 * neither.
 */
function detectRisks(
  points: ForecastPoint[],
  payroll: Array<{ date: Date; minorUnits: number }>,
  receivables: Array<{ balance: number; expectedDate: Date; customer: string }>,
  asOf: Date,
  startingCash: number,
): RiskEvent[] {
  const risks: RiskEvent[] = [];
  const byDate = new Map(points.map((p) => [p.date, p]));

  // ── Payroll shortfall — the wedge ────────────────────────────────────────
  for (const run of payroll) {
    const key = dayKey(run.date);
    const point = byDate.get(key);
    if (!point) continue;

    // Evaluated at P50, not P10: warning on the pessimistic tail would fire
    // constantly and burn the alert channel (prd.md §5.4).
    const projected = point.p50;
    if (projected >= run.minorUnits) continue;

    const shortfall = run.minorUnits - projected;
    const daysAway = Math.round((run.date.getTime() - asOf.getTime()) / 86400000);

    // Actions carry their estimated impact. "Collect overdue invoices" is
    // advice; "+$38,100" is a plan.
    const late = receivables
      .filter((r) => r.expectedDate > run.date)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 3);
    const collectable = late.reduce((s, r) => s + r.balance, 0);

    risks.push({
      kind: 'payroll_shortfall',
      severity: daysAway <= 7 ? 'critical' : daysAway <= 21 ? 'high' : 'medium',
      date: key,
      headline: `${key} payroll is projected ${Money.format(Money.money(shortfall, 'USD'))} short.`,
      shortfallMinor: shortfall,
      daysAway,
      drivers: late.length
        ? [`${late.length} invoice(s) totalling ${Money.format(Money.money(collectable, 'USD'))} land after this date`]
        : ['Projected outflows exceed available cash on this date'],
      actions: [
        ...(collectable > 0
          ? [{
              text: `Collect ${late.length} outstanding invoice(s) — ${late.map((r) => r.customer).join(', ')}`,
              impactMinor: collectable,
              type: 'collect',
            }]
          : []),
        { text: 'Defer discretionary spend until after this date', impactMinor: 0, type: 'reduce' },
        { text: 'Draw on a credit line', impactMinor: shortfall, type: 'finance' },
      ],
    });
  }

  // ── General cash shortfall ───────────────────────────────────────────────
  const firstNegative = points.find((p) => p.p50 < 0);
  if (firstNegative) {
    const daysAway = Math.round(
      (Date.parse(firstNegative.date) - asOf.getTime()) / 86400000,
    );
    risks.push({
      kind: 'cash_shortfall',
      severity: daysAway <= 30 ? 'critical' : 'high',
      date: firstNegative.date,
      headline: `Cash is projected to go negative around ${firstNegative.date}.`,
      shortfallMinor: Math.abs(firstNegative.p50),
      daysAway,
      drivers: ['Committed outflows exceed projected collections'],
      actions: [{ text: 'Model a combination of levers', impactMinor: 0, type: 'defer_decision' }],
    });
  }

  // ── Runway threshold ─────────────────────────────────────────────────────
  const last = points[points.length - 1];
  if (last && startingCash > 0 && last.p50 < startingCash * 0.35 && !firstNegative) {
    risks.push({
      kind: 'runway_threshold',
      severity: 'medium',
      date: last.date,
      headline: `Cash is projected to fall by ${Math.round((1 - last.p50 / startingCash) * 100)}% over the next quarter.`,
      shortfallMinor: startingCash - last.p50,
      daysAway: points.length,
      drivers: ['Sustained net outflow across the forecast horizon'],
      actions: [{ text: 'Review the largest expense categories', impactMinor: 0, type: 'reduce' }],
    });
  }

  return risks.sort((a, b) => a.daysAway - b.daysAway);
}
