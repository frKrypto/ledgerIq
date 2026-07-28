import * as Money from '@ledgeriq/core/money';

/**
 * QuickBooks → canonical model.
 *
 * This is the layer that turns a provider's idea of a financial record into ours.
 * It is the highest-risk code in the ingestion path: everything downstream — every
 * metric, every forecast, every answer — inherits whatever this gets wrong, and
 * it gets it wrong silently. A mis-mapped account doesn't throw; it just makes
 * gross margin quietly incorrect.
 *
 * Three rules govern it:
 *
 *   1. Never invent. If a field isn't present, the canonical record says so
 *      rather than defaulting to a plausible value.
 *   2. Never guess silently. An ambiguous account mapping is recorded with low
 *      confidence and flagged for review, not resolved by coin-flip.
 *   3. Never lose the link. Every canonical row carries its source id so a
 *      figure can be traced back to what Intuit actually returned.
 */

export const TRANSFORM_VERSION = '2026.07.1';

export type StatementClass =
  | 'revenue' | 'cogs' | 'opex' | 'payroll'
  | 'other_income' | 'other_expense' | 'asset' | 'liability' | 'equity';

export interface CanonicalAccount {
  readonly sourceAccountId: string;
  readonly name: string;
  readonly accountType: string;
  readonly accountSubtype: string;
  readonly statement: StatementClass | null;
  /** Specific canonical category, not just the statement class. */
  readonly categoryKey: string;
  readonly mappingConfidence: number;
  readonly needsReview: boolean;
  /**
   * Where we suspect this account belongs, when we disagree with how the
   * business classified it. Never applied silently — see mapAccountToStatement.
   */
  readonly suggestedStatement: StatementClass | null;
}

export interface CanonicalTransaction {
  readonly sourceTxnId: string;
  readonly sourceRecordType: string;
  readonly direction: 'inflow' | 'outflow';
  readonly amountMinor: number;
  readonly occurredAt: string;
  readonly postedAt: string | null;
  readonly description: string | null;
  readonly merchantName: string | null;
  readonly sourceAccountId: string | null;
  readonly sourceCustomerId: string | null;
  readonly statement: StatementClass | null;
  readonly categoryKey: string;
  readonly categorySource: 'source_system' | 'default';
  readonly categoryConfidence: number;
  readonly isTransfer: boolean;
}

export interface CanonicalInvoice {
  readonly sourceInvoiceId: string;
  readonly number: string | null;
  readonly sourceCustomerId: string | null;
  readonly issuedOn: string;
  readonly dueDate: string | null;
  readonly termsDays: number | null;
  readonly totalMinor: number;
  readonly balanceMinor: number;
  readonly status: 'open' | 'partial' | 'paid' | 'overdue';
  readonly paidOn: string | null;
}

export interface NormalizationWarning {
  readonly kind:
    | 'unmapped_account'
    | 'ambiguous_account'
    | 'missing_field'
    | 'unparseable_amount'
    /** Line amounts do not sum to the document total — usually tax or shipping. */
    | 'amount_mismatch';
  readonly detail: string;
  readonly sourceId?: string;
}

/**
 * Map a QuickBooks account to our statement vocabulary.
 *
 * QBO's AccountType/AccountSubType is a reasonable signal but not sufficient:
 * businesses put payroll under generic "Expense", and subcontractor costs land in
 * COGS or Expense depending on who set the books up. So the mapping is layered —
 * subtype first (most specific), then type, then a name heuristic — and the
 * confidence it returns reflects which layer answered.
 *
 * Anything below 0.7 is flagged for human confirmation during onboarding rather
 * than silently accepted. Guessing here produces confidently wrong margins.
 */
export function mapAccountToStatement(account: {
  AccountType?: string;
  AccountSubType?: string;
  Name?: string;
}): { statement: StatementClass | null; confidence: number; suggested?: StatementClass } {
  const type = (account.AccountType ?? '').toLowerCase();
  const subtype = (account.AccountSubType ?? '').toLowerCase();
  const name = (account.Name ?? '').toLowerCase();

  // Layer 1 — subtype. Most specific, highest confidence.
  if (subtype.includes('payrolltax')) return { statement: 'payroll', confidence: 0.98 };
  if (subtype.includes('payroll')) return { statement: 'payroll', confidence: 0.95 };
  if (subtype.endsWith('cogs') || subtype.includes('costofservice')) {
    return { statement: 'cogs', confidence: 0.95 };
  }

  // Layer 2 — type.
  if (type.includes('income') && !type.includes('other')) {
    return { statement: 'revenue', confidence: 0.95 };
  }
  if (type.includes('other income')) return { statement: 'other_income', confidence: 0.9 };
  if (type.includes('cost of goods')) return { statement: 'cogs', confidence: 0.92 };
  if (type === 'bank') return { statement: 'asset', confidence: 0.98 };
  if (type.includes('credit card')) return { statement: 'liability', confidence: 0.98 };
  if (type.includes('equity')) return { statement: 'equity', confidence: 0.95 };
  if (type.includes('liability') || type.includes('payable')) {
    return { statement: 'liability', confidence: 0.9 };
  }
  if (type.includes('asset') || type.includes('receivable')) {
    return { statement: 'asset', confidence: 0.9 };
  }

  if (type.includes('expense')) {
    // Layer 3 — name heuristics, at deliberately lower confidence. These are
    // guesses and are labelled as such.
    if (/payroll|salar|wage/.test(name)) return { statement: 'payroll', confidence: 0.85 };
    if (/subcontract|contractor|freelance/.test(name)) {
      // The genuinely ambiguous case: subcontractor cost is COGS if it is
      // billable project work and overhead if it is not, and the account name
      // alone cannot distinguish them.
      //
      // This used to answer 'cogs' and it was wrong — not about accounting, but
      // about authority. The business put this account under Expense, and
      // reclassifying it silently means our P&L stops matching the P&L they can
      // pull from QuickBooks themselves. "Your gross margin is 65%" against their
      // own books saying 61% does not read as insight; it reads as a bug, and it
      // is unarguable because they have the source system open.
      //
      // The reconciliation harness caught exactly this: a $12,979 COGS
      // divergence with no code defect behind it.
      //
      // So the source system wins on classification, and the disagreement becomes
      // a question to ask during chart-of-accounts confirmation rather than a
      // number changed behind the user's back.
      return { statement: 'opex', confidence: 0.55, suggested: 'cogs' };
    }
    if (/tax/.test(name)) return { statement: 'other_expense', confidence: 0.75 };
    if (/interest/.test(name)) return { statement: 'other_expense', confidence: 0.8 };
    return { statement: 'opex', confidence: 0.88 };
  }

  return { statement: null, confidence: 0 };
}

/**
 * Map an account to a SPECIFIC canonical category.
 *
 * Distinct from the statement mapping, and necessary: deriving the category from
 * the statement class alone collapses rent, software, marketing, travel and
 * professional fees into a single "Other Operating" bucket. The expense
 * breakdown then shows three rows and tells the user nothing — which defeats
 * the point of having it.
 *
 * Name-based because QuickBooks' AccountSubType is too coarse for this: most
 * operating expenses share OfficeGeneralAdministrativeExpenses regardless of
 * what they actually are.
 */
export function mapAccountToCategory(
  account: { Name?: string; AccountSubType?: string },
  statement: StatementClass | null,
): string {
  const name = (account.Name ?? '').toLowerCase();

  if (statement === 'revenue') {
    return /retainer|recurring|subscription/.test(name) ? 'revenue.services' : 'revenue.services';
  }
  if (statement === 'payroll') {
    if (/tax/.test(name)) return 'payroll.taxes';
    if (/benefit|health|dental|insurance/.test(name)) return 'payroll.benefits';
    return 'payroll.wages';
  }
  if (statement === 'cogs') {
    if (/host|cloud|aws|server|infra/.test(name)) return 'cogs.hosting';
    if (/material|supply|supplies/.test(name)) return 'cogs.materials';
    return 'cogs.subcontractors';
  }
  if (statement === 'opex') {
    if (/rent|lease/.test(name)) return 'opex.rent';
    if (/software|subscription|saas|licen/.test(name)) return 'opex.software';
    if (/marketing|advertis|promo/.test(name)) return 'opex.marketing';
    if (/travel|meal|entertain/.test(name)) return 'opex.travel';
    if (/legal|professional|account|consult/.test(name)) return 'opex.professional';
    if (/insurance/.test(name)) return 'opex.insurance';
    if (/utilit|power|electric|internet|phone/.test(name)) return 'opex.utilities';
    if (/office|supply|supplies/.test(name)) return 'opex.office';
    return 'opex.other';
  }
  if (statement === 'other_expense') {
    return /interest/.test(name) ? 'other.interest' : 'other.taxes';
  }
  return 'uncategorized';
}

const CONFIDENCE_REVIEW_THRESHOLD = 0.7;

export function normalizeAccounts(records: unknown[]): {
  accounts: CanonicalAccount[];
  warnings: NormalizationWarning[];
} {
  const accounts: CanonicalAccount[] = [];
  const warnings: NormalizationWarning[] = [];

  for (const raw of records) {
    const a = raw as {
      Id?: string; Name?: string; AccountType?: string; AccountSubType?: string;
    };
    if (!a.Id) {
      warnings.push({ kind: 'missing_field', detail: 'Account without Id' });
      continue;
    }

    const { statement, confidence, suggested } = mapAccountToStatement(a);
    const needsReview = statement === null || confidence < CONFIDENCE_REVIEW_THRESHOLD;

    if (statement === null) {
      warnings.push({
        kind: 'unmapped_account',
        detail: `"${a.Name ?? a.Id}" (${a.AccountType ?? 'no type'}) has no statement mapping`,
        sourceId: a.Id,
      });
    } else if (needsReview) {
      warnings.push({
        kind: 'ambiguous_account',
        detail:
          `"${a.Name ?? a.Id}" kept as ${statement} at ${Math.round(confidence * 100)}%` +
          (suggested ? ` — may belong in ${suggested}; confirm with the owner` : ' — needs confirmation'),
        sourceId: a.Id,
      });
    }

    accounts.push({
      sourceAccountId: a.Id,
      name: a.Name ?? `Account ${a.Id}`,
      accountType: a.AccountType ?? '',
      accountSubtype: a.AccountSubType ?? '',
      statement,
      categoryKey: mapAccountToCategory(a, statement),
      mappingConfidence: confidence,
      needsReview,
      suggestedStatement: suggested ?? null,
    });
  }

  return { accounts, warnings };
}

/**
 * Parse a QuickBooks amount into minor units.
 *
 * QBO returns amounts as JSON numbers, which have already been through a binary
 * float by the time we see them. Routing via a fixed-precision string is the
 * closest we can get to lossless, and it keeps the "money is never a float" rule
 * intact from this boundary inward.
 */
function parseAmount(value: unknown, warnings: NormalizationWarning[], id: string): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push({ kind: 'unparseable_amount', detail: `Amount ${String(value)}`, sourceId: id });
    return null;
  }
  return Money.roundToMinorUnits(value.toFixed(4), 'USD').minorUnits;
}

/** Coarse fallback, used only when an expense has no line-level account. */
const statementToCategoryKey: Record<StatementClass, string> = {
  revenue: 'revenue.services',
  cogs: 'cogs.subcontractors',
  payroll: 'payroll.wages',
  opex: 'opex.other',
  other_income: 'revenue.other',
  other_expense: 'other.taxes',
  asset: 'uncategorized',
  liability: 'uncategorized',
  equity: 'uncategorized',
};

export interface AccountLookup {
  statementFor(sourceAccountId: string): StatementClass | null;
  nameFor(sourceAccountId: string): string | null;
  categoryKeyFor(sourceAccountId: string): string | null;
}

/** Purchases and Bills → outflow transactions. */
export function normalizeExpenses(
  records: unknown[],
  recordType: 'Purchase' | 'Bill',
  accounts: AccountLookup,
): { transactions: CanonicalTransaction[]; warnings: NormalizationWarning[] } {
  const transactions: CanonicalTransaction[] = [];
  const warnings: NormalizationWarning[] = [];

  for (const raw of records) {
    const p = raw as {
      Id?: string; TxnDate?: string; TotalAmt?: number;
      EntityRef?: { name?: string }; VendorRef?: { name?: string };
      Line?: Array<{
        Amount?: number;
        Description?: string;
        AccountBasedExpenseLineDetail?: { AccountRef?: { value?: string } };
      }>;
    };
    if (!p.Id || !p.TxnDate) {
      warnings.push({ kind: 'missing_field', detail: `${recordType} missing Id or TxnDate` });
      continue;
    }

    // Expand line items rather than collapsing to the header total: a single
    // purchase can span several accounts, and collapsing it would attribute the
    // whole amount to one category. That is how expense breakdowns silently
    // become wrong.
    const lines = p.Line ?? [];
    const merchant = p.EntityRef?.name ?? p.VendorRef?.name ?? null;

    if (lines.length === 0) {
      const amount = parseAmount(p.TotalAmt, warnings, p.Id);
      if (amount === null) continue;
      transactions.push({
        sourceTxnId: p.Id,
        sourceRecordType: recordType,
        direction: 'outflow',
        amountMinor: amount,
        occurredAt: p.TxnDate,
        postedAt: recordType === 'Purchase' ? p.TxnDate : null,
        description: null,
        merchantName: merchant,
        sourceAccountId: null,
        sourceCustomerId: null,
        statement: null,
        // No line-level account to map from, so fall back to the coarse
        // statement-level default. Confidence 0 marks it as a guess.
        categoryKey: statementToCategoryKey['opex'],
        categorySource: 'default',
        categoryConfidence: 0,
        isTransfer: false,
      });
      continue;
    }

    for (const [i, line] of lines.entries()) {
      const amount = parseAmount(line.Amount, warnings, p.Id);
      if (amount === null) continue;

      const accountId = line.AccountBasedExpenseLineDetail?.AccountRef?.value ?? null;
      const statement = accountId ? accounts.statementFor(accountId) : null;

      transactions.push({
        // Line-level ids so re-ingesting is idempotent per line, not per header.
        sourceTxnId: `${p.Id}:${i}`,
        sourceRecordType: recordType,
        direction: 'outflow',
        amountMinor: amount,
        occurredAt: p.TxnDate,
        // A Purchase is cash out immediately; a Bill is an obligation that
        // settles later. Treating them alike would make the cash forecast wrong
        // in the direction that matters most.
        postedAt: recordType === 'Purchase' ? p.TxnDate : null,
        description: line.Description ?? null,
        merchantName: merchant ?? (accountId ? accounts.nameFor(accountId) : null),
        sourceAccountId: accountId,
        sourceCustomerId: null,
        statement,
        // The account's own category, not a statement-wide default.
        categoryKey: accountId
          ? (accounts.categoryKeyFor(accountId) ?? 'uncategorized')
          : 'uncategorized',
        categorySource: statement ? 'source_system' : 'default',
        categoryConfidence: statement ? 0.9 : 0,
        isTransfer: false,
      });
    }
  }

  return { transactions, warnings };
}

/** Payments → inflow transactions (cash actually received). */
export function normalizePayments(records: unknown[]): {
  transactions: CanonicalTransaction[];
  warnings: NormalizationWarning[];
} {
  const transactions: CanonicalTransaction[] = [];
  const warnings: NormalizationWarning[] = [];

  for (const raw of records) {
    const p = raw as {
      Id?: string; TxnDate?: string; TotalAmt?: number;
      CustomerRef?: { value?: string; name?: string };
    };
    if (!p.Id || !p.TxnDate) {
      warnings.push({ kind: 'missing_field', detail: 'Payment missing Id or TxnDate' });
      continue;
    }
    const amount = parseAmount(p.TotalAmt, warnings, p.Id);
    if (amount === null) continue;

    transactions.push({
      sourceTxnId: p.Id,
      sourceRecordType: 'Payment',
      direction: 'inflow',
      amountMinor: amount,
      occurredAt: p.TxnDate,
      postedAt: p.TxnDate,
      description: p.CustomerRef?.name ? `Payment — ${p.CustomerRef.name}` : 'Customer payment',
      merchantName: p.CustomerRef?.name ?? null,
      sourceAccountId: null,
      sourceCustomerId: p.CustomerRef?.value ?? null,
      // A payment is cash movement against a receivable, not new revenue.
      // Counting both the invoice and the payment as revenue double-counts —
      // a classic and very visible error.
      statement: 'asset',
      categoryKey: 'uncategorized',
      categorySource: 'source_system',
      categoryConfidence: 0.95,
      isTransfer: false,
    });
  }

  return { transactions, warnings };
}

/**
 * Invoices → accrual revenue transactions + invoice records.
 *
 * The invoice is what recognizes revenue (accrual); the payment is what moves
 * cash. Both are needed, and they are deliberately different records.
 */
export function normalizeInvoices(records: unknown[]): {
  invoices: CanonicalInvoice[];
  transactions: CanonicalTransaction[];
  warnings: NormalizationWarning[];
} {
  const invoices: CanonicalInvoice[] = [];
  const transactions: CanonicalTransaction[] = [];
  const warnings: NormalizationWarning[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const raw of records) {
    const inv = raw as {
      Id?: string; DocNumber?: string; TxnDate?: string; DueDate?: string;
      TotalAmt?: number; Balance?: number;
      CustomerRef?: { value?: string; name?: string };
      SalesTermRef?: { value?: string };
      MetaData?: { LastUpdatedTime?: string };
    };
    if (!inv.Id || !inv.TxnDate) {
      warnings.push({ kind: 'missing_field', detail: 'Invoice missing Id or TxnDate' });
      continue;
    }

    const total = parseAmount(inv.TotalAmt, warnings, inv.Id);
    if (total === null) continue;
    const balance = parseAmount(inv.Balance ?? 0, warnings, inv.Id) ?? 0;

    const paid = balance === 0;
    const overdue = !paid && inv.DueDate !== undefined && inv.DueDate < today;
    const status: CanonicalInvoice['status'] = paid
      ? 'paid'
      : overdue ? 'overdue'
      : balance < total ? 'partial' : 'open';

    invoices.push({
      sourceInvoiceId: inv.Id,
      number: inv.DocNumber ?? null,
      sourceCustomerId: inv.CustomerRef?.value ?? null,
      issuedOn: inv.TxnDate,
      dueDate: inv.DueDate ?? null,
      termsDays: inv.SalesTermRef?.value ? Number(inv.SalesTermRef.value) : null,
      totalMinor: total,
      balanceMinor: balance,
      status,
      // QBO does not expose a payment date on the invoice. Using the last-updated
      // timestamp is an approximation and is only used when the balance is
      // zero — it is not treated as authoritative.
      paidOn: paid && inv.MetaData?.LastUpdatedTime
        ? inv.MetaData.LastUpdatedTime.slice(0, 10)
        : null,
    });

    // Revenue is recognized per LINE, against the income account each line names.
    //
    // Collapsing an invoice to one TotalAmt transaction with no account was the
    // original behaviour, and the reconciliation harness caught what it costs:
    // every dollar of revenue landed as "(unmapped)". Section totals still
    // agreed, so nothing looked wrong — but revenue could not be split by income
    // account at all, which on a business with several revenue streams is most of
    // the question being asked.
    //
    // It also fixes a correctness bug that the demo's single-line invoices hide:
    // TotalAmt includes sales tax, and sales tax is a liability, not revenue.
    const lines = Array.isArray((raw as { Line?: unknown[] }).Line)
      ? ((raw as { Line: unknown[] }).Line)
      : [];

    let recognized = 0;
    let lineIndex = 0;

    for (const rawLine of lines) {
      const line = rawLine as {
        Id?: string; Amount?: number; DetailType?: string;
        Description?: string;
        SalesItemLineDetail?: { ItemAccountRef?: { value?: string; name?: string } };
      };
      lineIndex += 1;

      const accountRef = line.SalesItemLineDetail?.ItemAccountRef?.value;
      if (accountRef === undefined) continue; // tax, discount, subtotal — not revenue

      const amount = parseAmount(line.Amount, warnings, inv.Id);
      if (amount === null) continue;
      recognized += amount;

      transactions.push({
        sourceTxnId: `${inv.Id}:${line.Id ?? lineIndex}`,
        sourceRecordType: 'Invoice',
        direction: 'inflow',
        amountMinor: amount,
        occurredAt: inv.TxnDate,
        // Accrual revenue: recognized when invoiced, not when paid. postedAt is
        // null because no cash has moved.
        postedAt: null,
        description: line.Description
          ?? (inv.CustomerRef?.name ? `Invoice — ${inv.CustomerRef.name}` : 'Invoice'),
        merchantName: inv.CustomerRef?.name ?? null,
        sourceAccountId: accountRef,
        sourceCustomerId: inv.CustomerRef?.value ?? null,
        statement: 'revenue',
        categoryKey: 'revenue.services',
        categorySource: 'source_system',
        categoryConfidence: 0.95,
        isTransfer: false,
      });
    }

    if (recognized === 0) {
      // No line named an income account. Rather than drop the revenue, fall back
      // to the invoice total and say so — an unmapped dollar is recoverable, a
      // missing one is not.
      warnings.push({
        kind: 'unmapped_account',
        detail: `Invoice ${inv.Id} has no income-account line; recognized against no account`,
      });
      transactions.push({
        sourceTxnId: inv.Id,
        sourceRecordType: 'Invoice',
        direction: 'inflow',
        amountMinor: total,
        occurredAt: inv.TxnDate,
        postedAt: null,
        description: inv.CustomerRef?.name ? `Invoice — ${inv.CustomerRef.name}` : 'Invoice',
        merchantName: inv.CustomerRef?.name ?? null,
        sourceAccountId: null,
        sourceCustomerId: inv.CustomerRef?.value ?? null,
        statement: 'revenue',
        categoryKey: 'revenue.services',
        categorySource: 'source_system',
        categoryConfidence: 0.95,
        isTransfer: false,
      });
    } else if (recognized !== total) {
      // Expected on real books — sales tax and shipping live in TotalAmt but are
      // not revenue. Recorded so the gap is visible rather than surprising.
      warnings.push({
        kind: 'amount_mismatch',
        detail:
          `Invoice ${inv.Id}: income lines total ${recognized} against TotalAmt ${total}; ` +
          `the difference is tax or other non-revenue and is not recognized as income`,
      });
    }
  }

  return { invoices, transactions, warnings };
}

/** Fit a per-customer payment-lag distribution from observed invoice history. */
export function fitPaymentBehavior(
  invoices: readonly CanonicalInvoice[],
): { meanDaysLate: number; stddev: number; p50: number; p90: number; sampleCount: number } | null {
  const lags: number[] = [];
  for (const inv of invoices) {
    if (inv.status !== 'paid' || !inv.paidOn || !inv.dueDate) continue;
    const lag = (Date.parse(inv.paidOn) - Date.parse(inv.dueDate)) / 86400000;
    if (Number.isFinite(lag)) lags.push(lag);
  }
  // Below ~4 observations this is noise, and a confident forecast built on noise
  // is worse than a wide one. Returning null lets the caller fall back to a
  // prior and widen the band.
  if (lags.length < 4) return null;

  lags.sort((a, b) => a - b);
  const mean = lags.reduce((s, v) => s + v, 0) / lags.length;
  const variance = lags.reduce((s, v) => s + (v - mean) ** 2, 0) / lags.length;

  return {
    meanDaysLate: mean,
    stddev: Math.sqrt(variance),
    p50: lags[Math.floor(lags.length * 0.5)] ?? mean,
    p90: lags[Math.floor(lags.length * 0.9)] ?? mean,
    sampleCount: lags.length,
  };
}
