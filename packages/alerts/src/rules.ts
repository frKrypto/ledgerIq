import type { Forecast, RiskEvent } from '@ledgeriq/metrics';

/**
 * Alert rules, and the budget that governs them.
 *
 * The failure mode of an alerting product is not missing an alert. It is sending
 * three bad ones, getting muted, and thereby missing every alert afterwards —
 * silently, permanently, and without anyone filing a complaint. So most of this
 * file is about *not* sending things.
 *
 * Four gates, each closing a distinct way noise gets through:
 *
 *   1. **Confidence.** A forecast that says `low` or `insufficient_data` has not
 *      earned the right to wake anyone up. Alerting on a thin ledger converts a
 *      data-coverage problem into a fake financial emergency.
 *
 *   2. **Materiality, relative to the business.** $5,000 is an emergency at
 *      $200K revenue and rounding error at $20M. Absolute thresholds do not
 *      survive contact with a customer base.
 *
 *   3. **Confirmation.** A forecast is probabilistic; a risk that appears in one
 *      evaluation and vanishes in the next is noise. Two consecutive sightings
 *      before a non-critical alert fires.
 *
 *   4. **Deduplication.** The same condition fires once, ever. Restating it every
 *      night is how a useful warning becomes wallpaper.
 *
 * The band calibration matters here more than anywhere. "Fire when P10 crosses
 * the payroll floor" is a probability claim, and it was meaningless while P10 was
 * built from invented constants — the band had 0% coverage. Now that the band is
 * measured, a P10 breach genuinely means roughly a one-in-ten downside.
 */

export interface AlertCandidate {
  readonly ruleKey: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'info';
  readonly title: string;
  readonly body: string;
  /** Computed values the body references. Never restated as literals in text. */
  readonly figures: Record<string, number | string>;
  readonly recommendedAction: { text: string; impactMinor: number } | null;
  readonly dedupKey: string;
  readonly materialityMinor: number;
  /** Consecutive sightings required before this may be sent. */
  readonly confirmationsRequired: number;
}

export interface AlertContext {
  readonly forecast: Forecast;
  /** Trailing-twelve-month revenue, the denominator for materiality. */
  readonly annualRevenueMinor: number | null;
  /** Typical monthly operating expense, for runway-shaped judgements. */
  readonly monthlyOpexMinor: number | null;
}

/**
 * Materiality floor for a business of this size.
 *
 * 0.5% of annual revenue, with an absolute floor so a pre-revenue company still
 * gets warned about something real. The percentage is a starting point to be
 * tuned by "not useful" feedback, not a discovered constant — it is recorded here
 * rather than buried so that tuning is a visible decision.
 */
export const MATERIALITY_FRACTION_OF_REVENUE = 0.005;
export const MATERIALITY_ABSOLUTE_FLOOR_MINOR = 50_000; // $500

export function materialityThreshold(annualRevenueMinor: number | null): number {
  if (annualRevenueMinor === null || annualRevenueMinor <= 0) {
    return MATERIALITY_ABSOLUTE_FLOOR_MINOR;
  }
  return Math.max(
    MATERIALITY_ABSOLUTE_FLOOR_MINOR,
    Math.round(annualRevenueMinor * MATERIALITY_FRACTION_OF_REVENUE),
  );
}

const usd = (minor: number): string =>
  (minor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Evaluate every rule against the current forecast.
 *
 * Returns candidates, not alerts. Whether a candidate becomes an alert depends on
 * confirmation history and dedup state, which live in the database — see
 * `packages/db/src/repositories/alerts.ts`. Keeping evaluation pure makes the
 * rules testable without a database and, more importantly, makes it impossible
 * for a rule to send anything by itself.
 */
export function evaluateAlerts(ctx: AlertContext): AlertCandidate[] {
  const { forecast } = ctx;

  // Gate 1: confidence. Applied before any rule runs, deliberately — it is not
  // each rule's job to remember, and a rule added later would forget.
  if (forecast.confidence === 'insufficient_data' || forecast.confidence === 'low') {
    return [];
  }

  const threshold = materialityThreshold(ctx.annualRevenueMinor);
  const candidates: AlertCandidate[] = [];

  for (const risk of forecast.riskEvents) {
    const candidate = fromRiskEvent(risk, threshold, forecast);
    if (candidate) candidates.push(candidate);
  }

  const concentration = concentrationOfCash(forecast, threshold);
  if (concentration) candidates.push(concentration);

  return candidates;
}

function fromRiskEvent(
  risk: RiskEvent,
  thresholdMinor: number,
  forecast: Forecast,
): AlertCandidate | null {
  // Gate 2: materiality.
  if (Math.abs(risk.shortfallMinor) < thresholdMinor) return null;

  // Gate 3: confirmation. A critical payroll shortfall inside two weeks is the
  // one case where waiting for a second sighting costs more than being wrong —
  // the whole value of the warning is the lead time it buys.
  const urgent = risk.severity === 'critical' && risk.daysAway <= 14;

  const action = risk.actions[0];

  return {
    ruleKey: risk.kind,
    severity: risk.severity,
    title: risk.headline,
    // The body references figures by slot rather than restating them. A literal
    // here could drift from the computed value, which is the exact failure the
    // engine's whole design exists to prevent.
    body:
      `${risk.drivers.join(' ')} Projected shortfall of {{shortfall}} on {{date}}, ` +
      `{{daysAway}} days out. The forecast midpoint for that day is {{p50}}.`,
    figures: {
      shortfall: risk.shortfallMinor,
      shortfallFormatted: usd(risk.shortfallMinor),
      date: risk.date,
      daysAway: risk.daysAway,
      p50: forecast.points.find((p) => p.date === risk.date)?.p50 ?? 0,
    },
    recommendedAction: action ? { text: action.text, impactMinor: action.impactMinor } : null,
    // Dated, so the same risk on a different day is a different alert — but the
    // same risk re-detected for the same day is not.
    dedupKey: `${risk.kind}:${risk.date}`,
    materialityMinor: Math.abs(risk.shortfallMinor),
    confirmationsRequired: urgent ? 1 : 2,
  };
}

/**
 * The forecast's low case crosses zero even though no named risk fired.
 *
 * This exists because the risk detector evaluates at P50. A business whose
 * midpoint stays positive but whose P10 goes negative is genuinely at risk and
 * would otherwise hear nothing — and now that the band is calibrated, P10 means
 * something specific: roughly a one-in-ten chance of landing at or below this.
 */
function concentrationOfCash(forecast: Forecast, thresholdMinor: number): AlertCandidate | null {
  if (forecast.riskEvents.length > 0) return null; // already warned, more specifically

  const breach = forecast.points.find((p) => p.p10 < 0);
  if (!breach) return null;

  const shortfall = Math.abs(breach.p10);
  if (shortfall < thresholdMinor) return null;

  const daysAway = Math.round(
    (Date.parse(`${breach.date}T00:00:00Z`) - Date.parse(forecast.generatedAt)) / 86400000,
  );

  return {
    ruleKey: 'cash_downside_breach',
    severity: 'medium',
    title: 'Your downside case runs out of cash',
    body:
      `The midpoint forecast stays positive, but the low case reaches {{shortfall}} below zero ` +
      `on {{date}}, {{daysAway}} days out. Roughly a one-in-ten outcome, based on how this ` +
      `forecast has actually performed.`,
    figures: {
      shortfall: shortfall,
      shortfallFormatted: usd(shortfall),
      date: breach.date,
      daysAway,
      p50: breach.p50,
    },
    recommendedAction: null,
    dedupKey: `cash_downside_breach:${breach.date}`,
    materialityMinor: shortfall,
    confirmationsRequired: 2,
  };
}

/** Fill a slotted body with its figures. The only place text and numbers meet. */
export function renderBody(candidate: AlertCandidate): string {
  return candidate.body.replace(/\{\{(\w+)\}\}/g, (_, slot: string) => {
    const formatted = candidate.figures[`${slot}Formatted`];
    if (formatted !== undefined) return String(formatted);
    const raw = candidate.figures[slot];
    if (raw === undefined) {
      // Loud rather than silent: an unfilled slot in a financial alert is a bug
      // that must not reach a customer looking like prose.
      throw new Error(`Alert ${candidate.ruleKey} references unknown figure "${slot}"`);
    }
    return String(raw);
  });
}
