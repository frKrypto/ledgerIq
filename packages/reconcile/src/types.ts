/**
 * Reconciliation: does our canonical model agree with the source system?
 *
 * This is the question roadmap.md attaches Phase 0's kill criterion to, and it is
 * the one that everything downstream inherits. The metric engine, the forecast,
 * the alerts and eventually the narrator are all exactly as correct as the rows
 * underneath them — and until now those rows have only ever been checked against
 * a generator that shares their assumptions.
 *
 * The check is deliberately not "did the sync run" or "do the row counts look
 * right." It is: **take the source system's own P&L and see whether ours matches
 * it to the cent.** QuickBooks already knows what this business's revenue was.
 * If we disagree, we are wrong, and the disagreement is the most valuable signal
 * available at this stage.
 */

export type Section = 'income' | 'cogs' | 'expense';

export interface SourceAccountLine {
  readonly accountName: string;
  readonly section: Section;
  /** Positive magnitude in minor units, as the report presents it. */
  readonly amountMinor: number;
}

/**
 * A source system's profit & loss, normalized out of whatever shape it arrived
 * in. Parsing lives at the edge (see quickbooks-report.ts) so the comparison
 * logic never has to know about QuickBooks' nested report envelope.
 */
export interface SourceProfitAndLoss {
  readonly start: string;
  readonly end: string;
  readonly lines: SourceAccountLine[];
  readonly totals: {
    readonly income: number;
    readonly cogs: number;
    readonly grossProfit: number;
    readonly expenses: number;
    readonly netIncome: number;
  };
}

export type DiffStatus = 'match' | 'diverged' | 'missing_in_canonical' | 'missing_in_source';

export interface LineDiff {
  readonly label: string;
  readonly sourceMinor: number;
  readonly canonicalMinor: number;
  /** canonical − source. Positive means we are over-counting. */
  readonly deltaMinor: number;
  readonly status: DiffStatus;
}

export interface ReconciliationReport {
  readonly start: string;
  readonly end: string;
  /** True only when every section and every account agrees exactly. */
  readonly ok: boolean;
  /** Income, COGS, Expenses, Net income — the headline claim. */
  readonly sections: LineDiff[];
  /** Per-account, which is where a mapping bug actually shows itself. */
  readonly accounts: LineDiff[];
  readonly summary: {
    readonly matched: number;
    readonly diverged: number;
    readonly largestDeltaMinor: number;
    readonly largestDeltaLabel: string | null;
  };
}
