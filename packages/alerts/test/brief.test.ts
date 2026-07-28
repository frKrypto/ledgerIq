import { describe, expect, it } from 'vitest';
import { buildWeeklyBrief, type BriefContext } from '../src/brief.js';
import type { Forecast } from '@ledgeriq/metrics';

/**
 * The brief's hardest case is the quiet week, so that is what most of this
 * covers. Its open rate is the Phase 3 kill criterion, and a brief that only has
 * something to say when something is wrong teaches people that opening it is
 * usually a waste — which means it is not read on the week that matters.
 */

const forecast = { horizonDays: 91 } as Forecast;

const base: BriefContext = {
  weekEnding: '2026-08-02',
  forecast,
  openAlerts: [],
  cashMinor: 1_990_904_00,
  cashLastWeekMinor: 1_940_000_00,
  revenueMtdMinor: 280_000_00,
  runwayMonths: 14,
  largestOverdue: null,
  forecastAccuracy: null,
};

describe('a quiet week', () => {
  it('says nothing needs you, plainly', () => {
    const brief = buildWeeklyBrief(base);
    expect(brief.quiet).toBe(true);
    expect(brief.headline).toContain('Nothing needs you');
  });

  it('still says what it checked, so the message earns its place', () => {
    const brief = buildWeeklyBrief(base);
    expect(brief.sections.map((s) => s.key)).toContain('checked');
    expect(brief.sections.length).toBeGreaterThan(1);
  });

  it('does not manufacture a headline out of the largest number available', () => {
    const brief = buildWeeklyBrief(base);
    // No urgency words on a week with nothing wrong.
    expect(brief.headline).not.toMatch(/risk|urgent|shortfall|warning|alert/i);
  });
});

describe('a week that needs attention', () => {
  it('leads with the single thing, by name', () => {
    const brief = buildWeeklyBrief({
      ...base,
      openAlerts: [{ title: 'Payroll on Aug 15 is at risk', severity: 'critical' }],
    });
    expect(brief.quiet).toBe(false);
    expect(brief.headline).toBe('Payroll on Aug 15 is at risk');
    expect(brief.sections[0]?.key).toBe('needs_you');
  });

  it('counts them when there is more than one', () => {
    const brief = buildWeeklyBrief({
      ...base,
      openAlerts: [
        { title: 'Payroll at risk', severity: 'critical' },
        { title: 'Runway under 6 months', severity: 'high' },
      ],
    });
    expect(brief.headline).toBe('2 things need you this week.');
  });

  it('ignores low-severity noise when deciding whether the week was quiet', () => {
    const brief = buildWeeklyBrief({
      ...base,
      openAlerts: [{ title: 'Software spend up slightly', severity: 'info' }],
    });
    expect(brief.quiet).toBe(true);
  });
});

describe('honesty about its own accuracy', () => {
  it('admits when it has not measured itself yet', () => {
    const brief = buildWeeklyBrief(base);
    const checked = brief.sections.find((s) => s.key === 'checked');
    expect(checked?.body).toContain('not scored enough forecasts');
    expect(checked?.body).toContain('directional');
  });

  it('states the measured error once there is enough of it', () => {
    const brief = buildWeeklyBrief({
      ...base,
      forecastAccuracy: { horizonDays: 30, medianAbsPctError: 0.275, n: 68 },
    });
    const checked = brief.sections.find((s) => s.key === 'checked');
    expect(checked?.body).toContain('68 scored forecasts');
    expect(checked?.body).toContain('28%');
  });

  it('does not claim accuracy from a handful of samples', () => {
    const brief = buildWeeklyBrief({
      ...base,
      forecastAccuracy: { horizonDays: 30, medianAbsPctError: 0.02, n: 3 },
    });
    // Three lucky forecasts is not a track record, and quoting 2% off three
    // samples is the most flattering possible lie.
    expect(brief.sections.find((s) => s.key === 'checked')?.body).toContain('not scored enough');
  });
});

describe('the thing worth chasing', () => {
  it('names exactly one overdue invoice', () => {
    const brief = buildWeeklyBrief({
      ...base,
      largestOverdue: { customer: 'Vertex Industries', minorUnits: 99_716_03, daysLate: 22 },
    });
    const collect = brief.sections.find((s) => s.key === 'collect');
    expect(collect?.body).toContain('Vertex Industries');
    expect(collect?.body).toContain('22 days past due');
  });

  it('stays silent when nothing is actually late', () => {
    const brief = buildWeeklyBrief({
      ...base,
      largestOverdue: { customer: 'Vertex Industries', minorUnits: 99_716_03, daysLate: 0 },
    });
    expect(brief.sections.find((s) => s.key === 'collect')).toBeUndefined();
  });
});

describe('cash movement', () => {
  it('reports the direction against last week', () => {
    expect(buildWeeklyBrief(base).sections.find((s) => s.key === 'cash')?.body)
      .toContain('up $50,904');
  });

  it('says unchanged rather than "up $0"', () => {
    const brief = buildWeeklyBrief({ ...base, cashLastWeekMinor: base.cashMinor });
    expect(brief.sections.find((s) => s.key === 'cash')?.body).toContain('unchanged');
  });

  it('omits the comparison entirely when last week is unknown', () => {
    const brief = buildWeeklyBrief({ ...base, cashLastWeekMinor: null });
    const body = brief.sections.find((s) => s.key === 'cash')?.body ?? '';
    expect(body).not.toContain('from last week');
  });
});
