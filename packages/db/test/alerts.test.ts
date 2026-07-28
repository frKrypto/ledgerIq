import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateAlerts,
  materialityThreshold,
  renderBody,
  type AlertContext,
  type AlertCandidate,
} from '@ledgeriq/alerts';
import type { Forecast } from '@ledgeriq/metrics';
import { processAlertCandidates, resolveVanishedAlerts, listOpenAlerts } from '../src/repositories/alerts.js';
import type { TenantContext } from '../src/tenant-context.js';
import { setupTestDatabase, seedTwoTenants, type TestDatabase } from './helpers/database.js';

/**
 * Alerting is tested from the direction of restraint.
 *
 * The happy path — a real risk produces an alert — is one case here. The rest
 * cover the four ways noise gets through, because the failure this product
 * cannot recover from is being muted: it is silent, permanent, and generates no
 * complaint to learn from.
 */

let db: TestDatabase;
let tenants: Awaited<ReturnType<typeof seedTwoTenants>>;
let ctxA: TenantContext;
let ctxB: TenantContext;

beforeAll(async () => {
  db = await setupTestDatabase();
  tenants = await seedTwoTenants(db.adminPool);
  ctxA = { orgId: tenants.orgA, actor: { type: 'system', jobName: 'alerts-test' } };
  ctxB = { orgId: tenants.orgB, actor: { type: 'system', jobName: 'alerts-test' } };
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.adminPool.query('DELETE FROM alert_observations');
  await db.adminPool.query('DELETE FROM alerts');
});

const DAY = 86400000;

function makeForecast(overrides: Partial<Forecast> = {}): Forecast {
  const generatedAt = new Date().toISOString();
  const points = Array.from({ length: 91 }, (_, i) => ({
    date: new Date(Date.now() + (i + 1) * DAY).toISOString().slice(0, 10),
    p10: 500_000_00,
    p50: 1_000_000_00,
    p90: 1_500_000_00,
    committed: 0,
    receivables: 0,
    variable: 0,
  }));
  return {
    generatedAt,
    horizonDays: 91,
    startingCashMinor: 1_000_000_00,
    points,
    riskEvents: [],
    assumptions: [],
    confidence: 'high',
    historyDays: 500,
    methodVersion: '2026.07.2',
    ...overrides,
  };
}

function payrollRisk(daysAway: number, shortfallMinor: number, severity: 'critical' | 'medium' = 'critical') {
  const date = new Date(Date.now() + daysAway * DAY).toISOString().slice(0, 10);
  return {
    kind: 'payroll_shortfall' as const,
    severity,
    date,
    headline: `Payroll on ${date} is at risk`,
    shortfallMinor,
    daysAway,
    drivers: ['Two large invoices are projected to land after the pay date.'],
    actions: [{ text: 'Chase the Vertex invoice', impactMinor: 90_000_00, type: 'collect' }],
  };
}

const ctxFor = (forecast: Forecast, annualRevenueMinor: number | null = 3_000_000_00): AlertContext => ({
  forecast,
  annualRevenueMinor,
  monthlyOpexMinor: 200_000_00,
});

describe('materiality', () => {
  it('scales with the business rather than using a fixed dollar figure', () => {
    // The same shortfall is an emergency for one business and noise for another.
    const small = materialityThreshold(200_000_00);   // $200k revenue
    const large = materialityThreshold(20_000_000_00); // $20M revenue
    expect(large).toBeGreaterThan(small * 50);
  });

  it('keeps an absolute floor so a pre-revenue business still gets warned', () => {
    expect(materialityThreshold(null)).toBe(50_000);
    expect(materialityThreshold(0)).toBe(50_000);
  });

  it('suppresses a risk below the threshold for this business', () => {
    const forecast = makeForecast({ riskEvents: [payrollRisk(10, 100_00)] }); // $100
    expect(evaluateAlerts(ctxFor(forecast))).toHaveLength(0);
  });

  it('raises the same risk for a business small enough that it matters', () => {
    const forecast = makeForecast({ riskEvents: [payrollRisk(10, 60_000)] }); // $600
    expect(evaluateAlerts(ctxFor(forecast, 100_000_00))).toHaveLength(1);
  });
});

describe('confidence gate', () => {
  it('sends nothing when the forecast has insufficient data', () => {
    // Otherwise a data-coverage problem presents to the user as a financial
    // emergency, which is both wrong and the fastest route to being muted.
    const forecast = makeForecast({
      riskEvents: [payrollRisk(10, 500_000_00)],
      confidence: 'insufficient_data',
    });
    expect(evaluateAlerts(ctxFor(forecast))).toHaveLength(0);
  });

  it('sends nothing on a low-confidence forecast either', () => {
    const forecast = makeForecast({
      riskEvents: [payrollRisk(10, 500_000_00)],
      confidence: 'low',
    });
    expect(evaluateAlerts(ctxFor(forecast))).toHaveLength(0);
  });
});

describe('confirmation', () => {
  it('waits for a second sighting before sending a non-urgent alert', async () => {
    const forecast = makeForecast({ riskEvents: [payrollRisk(60, 500_000_00, 'medium')] });
    const candidates = evaluateAlerts(ctxFor(forecast));
    expect(candidates[0]?.confirmationsRequired).toBe(2);

    const first = await processAlertCandidates(db.appPool, ctxA, candidates);
    expect(first.raised).toHaveLength(0);
    expect(first.awaitingConfirmation).toBe(1);

    const second = await processAlertCandidates(db.appPool, ctxA, candidates);
    expect(second.raised).toHaveLength(1);
  });

  it('sends an urgent critical risk on the first sighting', async () => {
    // Waiting a day to confirm a payroll shortfall eleven days out spends the
    // lead time that is the entire value of the warning.
    const forecast = makeForecast({ riskEvents: [payrollRisk(11, 500_000_00)] });
    const result = await processAlertCandidates(db.appPool, ctxA, evaluateAlerts(ctxFor(forecast)));
    expect(result.raised).toHaveLength(1);
  });

  it('requires sightings to be CONSECUTIVE', async () => {
    // The subtle one. Seen in January, absent in February, seen in March is not
    // two confirmations — without clearing stale observations, "consecutive"
    // would be a word in a comment rather than a behaviour.
    const risky = makeForecast({ riskEvents: [payrollRisk(60, 500_000_00, 'medium')] });
    const calm = makeForecast();

    const candidates = evaluateAlerts(ctxFor(risky));
    await processAlertCandidates(db.appPool, ctxA, candidates);       // sighting 1
    const cleared = await processAlertCandidates(db.appPool, ctxA, evaluateAlerts(ctxFor(calm)));
    expect(cleared.stale).toBe(1);

    const again = await processAlertCandidates(db.appPool, ctxA, candidates); // starts over
    expect(again.raised).toHaveLength(0);
    expect(again.awaitingConfirmation).toBe(1);
  });
});

describe('deduplication', () => {
  it('never sends the same condition twice', async () => {
    const forecast = makeForecast({ riskEvents: [payrollRisk(11, 500_000_00)] });
    const candidates = evaluateAlerts(ctxFor(forecast));

    const first = await processAlertCandidates(db.appPool, ctxA, candidates);
    const second = await processAlertCandidates(db.appPool, ctxA, candidates);
    const third = await processAlertCandidates(db.appPool, ctxA, candidates);

    expect(first.raised).toHaveLength(1);
    expect(second.raised).toHaveLength(0);
    expect(second.suppressedAsDuplicate).toBe(1);
    expect(third.suppressedAsDuplicate).toBe(1);

    const { rows } = await db.adminPool.query(
      'SELECT count(*) AS n FROM alerts WHERE org_id = $1',
      [tenants.orgA],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('treats the same risk on a different date as a different alert', async () => {
    const a = makeForecast({ riskEvents: [payrollRisk(11, 500_000_00)] });
    const b = makeForecast({ riskEvents: [payrollRisk(25, 500_000_00)] });

    await processAlertCandidates(db.appPool, ctxA, evaluateAlerts(ctxFor(a)));

    // The 25-day risk is critical but not urgent, so it takes the normal two
    // confirmations rather than inheriting the first alert's urgency. Worth
    // asserting explicitly: the dedup key differing must not shortcut the
    // confirmation gate.
    const bCandidates = evaluateAlerts(ctxFor(b));
    expect(bCandidates[0]?.confirmationsRequired).toBe(2);

    const second = await processAlertCandidates(db.appPool, ctxA, bCandidates);
    expect(second.raised).toHaveLength(0);
    expect(second.awaitingConfirmation).toBe(1);

    const third = await processAlertCandidates(db.appPool, ctxA, bCandidates);
    expect(third.raised).toHaveLength(1);
    expect(third.raised[0]?.dedupKey).not.toBe(evaluateAlerts(ctxFor(a))[0]?.dedupKey);
  });

  it('resolves an alert when the risk goes away, so it can fire again later', async () => {
    // Permanent dedup is worse than noise: a shortfall warned about in March and
    // fixed would never warn again if it returned in September.
    const forecast = makeForecast({ riskEvents: [payrollRisk(11, 500_000_00)] });
    const candidates = evaluateAlerts(ctxFor(forecast));
    await processAlertCandidates(db.appPool, ctxA, candidates);

    expect(await resolveVanishedAlerts(db.appPool, ctxA, [])).toBe(1);
    expect(await listOpenAlerts(db.appPool, ctxA)).toHaveLength(0);
  });
});

describe('the downside-breach rule', () => {
  it('warns when P10 goes negative even though no named risk fired', async () => {
    // The risk detector evaluates at P50, so a business whose midpoint stays
    // positive but whose low case does not would otherwise hear nothing.
    const forecast = makeForecast();
    const points = forecast.points.map((p, i) =>
      i > 40 ? { ...p, p10: -200_000_00 } : p,
    );
    const candidates = evaluateAlerts(ctxFor({ ...forecast, points }));

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.ruleKey).toBe('cash_downside_breach');
  });

  it('stays quiet when a more specific risk already fired', () => {
    const forecast = makeForecast({ riskEvents: [payrollRisk(11, 500_000_00)] });
    const points = forecast.points.map((p) => ({ ...p, p10: -200_000_00 }));
    const candidates = evaluateAlerts(ctxFor({ ...forecast, points }));

    expect(candidates.map((c) => c.ruleKey)).toEqual(['payroll_shortfall']);
  });
});

describe('slotted bodies', () => {
  it('fills every slot from computed figures', () => {
    const forecast = makeForecast({ riskEvents: [payrollRisk(11, 500_000_00)] });
    const body = renderBody(evaluateAlerts(ctxFor(forecast))[0]!);
    expect(body).toContain('$500,000');
    expect(body).not.toContain('{{');
  });

  it('throws rather than shipping an unfilled slot to a customer', () => {
    const broken = {
      ruleKey: 'test', severity: 'info', title: 't',
      body: 'Cash is {{nonexistent}}.', figures: {},
      recommendedAction: null, dedupKey: 'k', materialityMinor: 0,
      confirmationsRequired: 1,
    } as AlertCandidate;
    expect(() => renderBody(broken)).toThrow(/unknown figure/);
  });
});

describe('tenant isolation', () => {
  it('does not leak alerts between organizations', async () => {
    const forecast = makeForecast({ riskEvents: [payrollRisk(11, 500_000_00)] });
    await processAlertCandidates(db.appPool, ctxA, evaluateAlerts(ctxFor(forecast)));

    expect(await listOpenAlerts(db.appPool, ctxB)).toHaveLength(0);
    expect(await listOpenAlerts(db.appPool, ctxA)).toHaveLength(1);
  });

  it('lets two orgs hold the same dedup key independently', async () => {
    // The unique constraint is (org_id, dedup_key). If it were on dedup_key
    // alone, one customer's alert would suppress another's.
    const forecast = makeForecast({ riskEvents: [payrollRisk(11, 500_000_00)] });
    const candidates = evaluateAlerts(ctxFor(forecast));

    const a = await processAlertCandidates(db.appPool, ctxA, candidates);
    const b = await processAlertCandidates(db.appPool, ctxB, candidates);

    expect(a.raised).toHaveLength(1);
    expect(b.raised).toHaveLength(1);
  });
});
