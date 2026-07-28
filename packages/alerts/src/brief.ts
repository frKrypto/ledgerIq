import type { Forecast } from '@ledgeriq/metrics';
import type { AlertCandidate } from './rules.js';

/**
 * The weekly brief.
 *
 * README bet #2: chat is the demo, the brief is the product. Chat has poor
 * standalone retention — people ask five questions in week one and none in week
 * four — so the thing that has to work is the message that arrives whether or not
 * anyone opens the app. Its open rate is the Phase 3 kill criterion, which makes
 * this one of the few surfaces where a design mistake is directly falsifiable.
 *
 * Two rules shape it:
 *
 * **A quiet week must read as a real answer, not as a failure to find news.**
 * Most weeks at a healthy business are quiet. If the brief has nothing to say
 * when nothing is wrong, it teaches people that opening it is usually a waste —
 * and then it is not there when the week is not quiet. "Nothing needs you, and
 * here is what I checked" is a service; filler dressed up as insight is not.
 *
 * **Never manufacture urgency.** The temptation is to promote the largest number
 * of the week into a headline. That produces a brief that cries wolf on a weekly
 * cadence, which is the same mute-button failure as bad alerts, just slower.
 */

export interface BriefSection {
  readonly key: string;
  readonly heading: string;
  readonly body: string;
  readonly figures: Record<string, number | string>;
}

export interface WeeklyBrief {
  readonly weekEnding: string;
  readonly headline: string;
  readonly sections: BriefSection[];
  readonly figures: Record<string, number | string>;
  /** True when the week genuinely had nothing requiring action. */
  readonly quiet: boolean;
}

export interface BriefContext {
  readonly weekEnding: string;
  readonly forecast: Forecast;
  readonly openAlerts: readonly { title: string; severity: string }[];
  readonly cashMinor: number | null;
  readonly cashLastWeekMinor: number | null;
  readonly revenueMtdMinor: number | null;
  readonly runwayMonths: number | null;
  /** Top receivable past due, if any. */
  readonly largestOverdue: { customer: string; minorUnits: number; daysLate: number } | null;
  /** Measured accuracy, so the brief can be honest about its own track record. */
  readonly forecastAccuracy: { horizonDays: number; medianAbsPctError: number; n: number } | null;
}

const usd = (minor: number): string =>
  (minor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function buildWeeklyBrief(ctx: BriefContext): WeeklyBrief {
  const sections: BriefSection[] = [];
  const critical = ctx.openAlerts.filter((a) => a.severity === 'critical' || a.severity === 'high');

  // ── What needs you ────────────────────────────────────────────────────────
  if (critical.length > 0) {
    sections.push({
      key: 'needs_you',
      heading: 'Needs you this week',
      body: critical.map((a) => `• ${a.title}`).join('\n'),
      figures: { count: critical.length },
    });
  }

  // ── Cash ──────────────────────────────────────────────────────────────────
  if (ctx.cashMinor !== null) {
    const delta =
      ctx.cashLastWeekMinor === null ? null : ctx.cashMinor - ctx.cashLastWeekMinor;
    sections.push({
      key: 'cash',
      heading: 'Cash',
      body:
        `You have ${usd(ctx.cashMinor)}` +
        (delta === null
          ? '.'
          : delta === 0
            ? ', unchanged from last week.'
            : `, ${delta > 0 ? 'up' : 'down'} ${usd(Math.abs(delta))} from last week.`) +
        (ctx.runwayMonths !== null ? ` That is about ${ctx.runwayMonths} months of runway.` : ''),
      figures: {
        cash: ctx.cashMinor,
        ...(delta !== null ? { delta } : {}),
        ...(ctx.runwayMonths !== null ? { runwayMonths: ctx.runwayMonths } : {}),
      },
    });
  }

  // ── The one thing worth chasing ───────────────────────────────────────────
  //
  // Exactly one, and only when it is genuinely overdue. A list of every open
  // invoice is a report, not a brief, and nobody acts on a report.
  if (ctx.largestOverdue && ctx.largestOverdue.daysLate > 0) {
    sections.push({
      key: 'collect',
      heading: 'Worth chasing',
      body:
        `${ctx.largestOverdue.customer} owes ${usd(ctx.largestOverdue.minorUnits)}, ` +
        `${ctx.largestOverdue.daysLate} days past due — the largest overdue balance you have.`,
      figures: {
        customer: ctx.largestOverdue.customer,
        amount: ctx.largestOverdue.minorUnits,
        daysLate: ctx.largestOverdue.daysLate,
      },
    });
  }

  // ── What I checked ────────────────────────────────────────────────────────
  //
  // The section that makes a quiet week feel like a service rather than an empty
  // inbox. It is also the honest one: it states the forecast's measured error
  // rather than implying certainty, and says so plainly when there is no
  // measurement yet.
  sections.push({
    key: 'checked',
    heading: 'What I checked',
    body:
      `I looked ${ctx.forecast.horizonDays} days ahead across your committed costs, ` +
      `open invoices, and typical spending. ` +
      (ctx.forecastAccuracy && ctx.forecastAccuracy.n >= 20
        ? `Over ${ctx.forecastAccuracy.n} scored forecasts, my ` +
          `${ctx.forecastAccuracy.horizonDays}-day numbers have been off by a median of ` +
          `${(ctx.forecastAccuracy.medianAbsPctError * 100).toFixed(0)}%.`
        : `I have not scored enough forecasts yet to tell you how accurate I have been — ` +
          `so treat the projections as directional for now.`),
    figures: {
      horizonDays: ctx.forecast.horizonDays,
      ...(ctx.forecastAccuracy ? { scoredForecasts: ctx.forecastAccuracy.n } : {}),
    },
  });

  const quiet = critical.length === 0;

  // The headline. On a quiet week it says so directly rather than reaching for
  // the biggest number available and dressing it up as news.
  const headline = quiet
    ? ctx.runwayMonths !== null
      ? `Nothing needs you. About ${ctx.runwayMonths} months of runway.`
      : 'Nothing needs you this week.'
    : critical.length === 1
      ? (critical[0]?.title ?? 'One thing needs you this week.')
      : `${critical.length} things need you this week.`;

  return {
    weekEnding: ctx.weekEnding,
    headline,
    sections,
    figures: {
      ...(ctx.cashMinor !== null ? { cash: ctx.cashMinor } : {}),
      ...(ctx.revenueMtdMinor !== null ? { revenueMtd: ctx.revenueMtdMinor } : {}),
      openAlerts: ctx.openAlerts.length,
    },
    quiet,
  };
}

/** Candidates promoted into the brief, for callers wiring the two together. */
export function briefWorthySeverities(candidates: readonly AlertCandidate[]): AlertCandidate[] {
  return candidates.filter((c) => c.severity === 'critical' || c.severity === 'high');
}
