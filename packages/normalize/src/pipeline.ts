import {
  normalizeAccounts,
  normalizeExpenses,
  normalizeInvoices,
  normalizePayments,
  type CanonicalAccount,
  type CanonicalInvoice,
  type CanonicalTransaction,
  type NormalizationWarning,
  type StatementClass,
} from './quickbooks.js';

/**
 * The whole QuickBooks → canonical transformation, in one place.
 *
 * This composition previously lived inside a CLI command, which meant anything
 * else wanting canonical rows — the reconciliation harness, the golden fixtures —
 * had to reimplement the account lookup and the ordering of the four normalizers.
 * Two implementations of "how we normalize" is exactly one too many for a
 * reconciler whose entire job is to detect normalization mistakes: it could have
 * agreed with itself while both copies were wrong.
 */

export interface CanonicalCustomer {
  readonly sourceId: string;
  readonly name: string;
  readonly email?: string;
}

export interface NormalizedBusiness {
  readonly accounts: CanonicalAccount[];
  readonly customers: CanonicalCustomer[];
  readonly invoices: CanonicalInvoice[];
  readonly transactions: CanonicalTransaction[];
  readonly warnings: NormalizationWarning[];
}

/** Records grouped by QuickBooks entity name, as they come out of the archive. */
export type RecordsByType = ReadonlyMap<string, unknown[]> | Record<string, unknown[]>;

export function normalizeQuickBooksBusiness(input: RecordsByType): NormalizedBusiness {
  const get = (type: string): unknown[] =>
    (input instanceof Map ? input.get(type) : (input as Record<string, unknown[]>)[type]) ?? [];

  // Accounts first: every expense line resolves its statement class and category
  // through the chart of accounts, so this lookup has to exist before the rest.
  const { accounts, warnings: accountWarnings } = normalizeAccounts(get('Account'));

  const statementBySourceId = new Map<string, StatementClass | null>(
    accounts.map((a) => [a.sourceAccountId, a.statement]),
  );
  const nameBySourceId = new Map(accounts.map((a) => [a.sourceAccountId, a.name]));
  const categoryBySourceId = new Map(accounts.map((a) => [a.sourceAccountId, a.categoryKey]));
  const lookup = {
    statementFor: (id: string): StatementClass | null => statementBySourceId.get(id) ?? null,
    nameFor: (id: string): string | null => nameBySourceId.get(id) ?? null,
    categoryKeyFor: (id: string): string | null => categoryBySourceId.get(id) ?? null,
  };

  const invoiceResult = normalizeInvoices(get('Invoice'));
  const paymentResult = normalizePayments(get('Payment'));
  const purchaseResult = normalizeExpenses(get('Purchase'), 'Purchase', lookup);
  const billResult = normalizeExpenses(get('Bill'), 'Bill', lookup);

  const customers = get('Customer')
    .map((raw) => {
      const c = raw as { Id?: string; DisplayName?: string; PrimaryEmailAddr?: { Address?: string } };
      return {
        sourceId: c.Id ?? '',
        name: c.DisplayName ?? 'Unknown',
        ...(c.PrimaryEmailAddr?.Address ? { email: c.PrimaryEmailAddr.Address } : {}),
      };
    })
    .filter((c) => c.sourceId !== '');

  return {
    accounts,
    customers,
    invoices: invoiceResult.invoices,
    transactions: [
      ...invoiceResult.transactions,
      ...paymentResult.transactions,
      ...purchaseResult.transactions,
      ...billResult.transactions,
    ],
    warnings: [
      ...accountWarnings,
      ...invoiceResult.warnings,
      ...paymentResult.warnings,
      ...purchaseResult.warnings,
      ...billResult.warnings,
    ],
  };
}
