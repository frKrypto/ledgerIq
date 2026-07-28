import { eq, sql } from 'drizzle-orm';
import type {
  CanonicalAccount,
  CanonicalInvoice,
  CanonicalTransaction,
} from '@ledgeriq/normalize';
import type { TenantDb } from '../tenant-context.js';
import {
  categories,
  customers,
  invoices,
  ledgerAccounts,
  transactions,
} from '../schema/index.js';

/**
 * Persist the canonical model.
 *
 * Everything here is idempotent on the source key, because ingestion is
 * at-least-once by design (backfill.ts): a page archived but not checkpointed is
 * re-fetched and re-normalized. Upserting rather than inserting is what turns
 * that from data corruption into a no-op.
 */

const money = (minorUnits: number): string => (minorUnits / 100).toFixed(4);

export async function loadCategoryMap(db: TenantDb): Promise<Map<string, string>> {
  const rows = await db.select({ id: categories.id, key: categories.key }).from(categories);
  return new Map(rows.map((r) => [r.key, r.id]));
}

export async function upsertLedgerAccounts(
  db: TenantDb,
  accounts: readonly CanonicalAccount[],
): Promise<Map<string, string>> {
  if (accounts.length === 0) return new Map();

  await db
    .insert(ledgerAccounts)
    .values(
      accounts.map((a) => ({
        orgId: db.orgId,
        source: 'quickbooks' as const,
        sourceAccountId: a.sourceAccountId,
        name: a.name,
        accountType: a.accountType,
        accountSubtype: a.accountSubtype,
        statement: a.statement,
        mappingConfidence: String(a.mappingConfidence),
        needsReview: a.needsReview,
      })),
    )
    .onConflictDoUpdate({
      target: [ledgerAccounts.orgId, ledgerAccounts.source, ledgerAccounts.sourceAccountId],
      set: {
        name: sql`excluded.name`,
        statement: sql`excluded.statement`,
        mappingConfidence: sql`excluded.mapping_confidence`,
        needsReview: sql`excluded.needs_review`,
      },
    });

  const rows = await db
    .select({ id: ledgerAccounts.id, sourceId: ledgerAccounts.sourceAccountId })
    .from(ledgerAccounts);
  return new Map(rows.map((r) => [r.sourceId, r.id]));
}

export async function upsertCustomers(
  db: TenantDb,
  records: Array<{ sourceId: string; name: string; email?: string }>,
): Promise<Map<string, string>> {
  if (records.length === 0) return new Map();

  await db
    .insert(customers)
    .values(
      records.map((c) => ({
        orgId: db.orgId,
        name: c.name,
        normalizedName: c.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        email: c.email ?? null,
        source: 'quickbooks' as const,
        sourceCustomerId: c.sourceId,
      })),
    )
    .onConflictDoUpdate({
      target: [customers.orgId, customers.source, customers.sourceCustomerId],
      set: { name: sql`excluded.name` },
    });

  const rows = await db
    .select({ id: customers.id, sourceId: customers.sourceCustomerId })
    .from(customers);
  return new Map(rows.filter((r) => r.sourceId).map((r) => [r.sourceId as string, r.id]));
}

export async function upsertTransactions(
  db: TenantDb,
  records: readonly CanonicalTransaction[],
  lookups: {
    ledgerAccounts: Map<string, string>;
    customers: Map<string, string>;
    categories: Map<string, string>;
  },
  transformVersion: string,
): Promise<number> {
  if (records.length === 0) return 0;

  // Chunked: a single multi-row INSERT with tens of thousands of rows blows past
  // Postgres's bind-parameter limit, and the failure mode is an opaque protocol
  // error rather than anything that names the real problem.
  const CHUNK = 500;
  let written = 0;

  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    await db
      .insert(transactions)
      .values(
        chunk.map((t) => ({
          orgId: db.orgId,
          ledgerAccountId: t.sourceAccountId
            ? (lookups.ledgerAccounts.get(t.sourceAccountId) ?? null)
            : null,
          direction: t.direction,
          amount: money(t.amountMinor),
          occurredAt: t.occurredAt,
          postedAt: t.postedAt,
          description: t.description,
          merchantName: t.merchantName,
          categoryId: lookups.categories.get(t.categoryKey) ?? null,
          statement: t.statement,
          categorySource: t.categorySource,
          categoryConfidence: String(t.categoryConfidence),
          customerId: t.sourceCustomerId
            ? (lookups.customers.get(t.sourceCustomerId) ?? null)
            : null,
          isTransfer: t.isTransfer,
          source: 'quickbooks' as const,
          sourceTxnId: t.sourceTxnId,
          sourceRecordType: t.sourceRecordType,
          transformVersion,
        })),
      )
      .onConflictDoNothing();
    written += chunk.length;
  }

  return written;
}

export async function upsertInvoices(
  db: TenantDb,
  records: readonly CanonicalInvoice[],
  customerMap: Map<string, string>,
): Promise<number> {
  if (records.length === 0) return 0;

  const CHUNK = 500;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    await db
      .insert(invoices)
      .values(
        chunk.map((inv) => ({
          orgId: db.orgId,
          customerId: inv.sourceCustomerId
            ? (customerMap.get(inv.sourceCustomerId) ?? null)
            : null,
          number: inv.number,
          status: inv.status,
          issuedOn: inv.issuedOn,
          dueDate: inv.dueDate,
          termsDays: inv.termsDays,
          total: money(inv.totalMinor),
          amountPaid: money(inv.totalMinor - inv.balanceMinor),
          paidOn: inv.paidOn,
          source: 'quickbooks' as const,
          sourceInvoiceId: inv.sourceInvoiceId,
        })),
      )
      .onConflictDoUpdate({
        target: [invoices.orgId, invoices.source, invoices.sourceInvoiceId],
        set: {
          status: sql`excluded.status`,
          amountPaid: sql`excluded.amount_paid`,
          paidOn: sql`excluded.paid_on`,
        },
      });
  }
  return records.length;
}

/**
 * Fit and store each customer's payment-lag distribution.
 *
 * The highest-leverage input to forecast accuracy. Run after invoices land,
 * because it is derived from observed payment history rather than from terms.
 */
export async function refreshPaymentBehavior(db: TenantDb): Promise<number> {
  const result = await db.execute(sql`
    WITH lags AS (
      SELECT customer_id,
             (paid_on - due_date) AS days_late
        FROM invoices
       WHERE status = 'paid' AND paid_on IS NOT NULL AND due_date IS NOT NULL
         AND customer_id IS NOT NULL AND voided_at IS NULL
    ),
    fitted AS (
      SELECT customer_id,
             avg(days_late) AS mean_days_late,
             coalesce(stddev_pop(days_late), 0) AS stddev,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY days_late) AS p50,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY days_late) AS p90,
             count(*) AS sample_count
        FROM lags GROUP BY customer_id
    )
    UPDATE customers c
       SET payment_behavior = jsonb_build_object(
             'meanDaysLate', round(f.mean_days_late::numeric, 2),
             'stddev',       round(f.stddev::numeric, 2),
             'p50',          f.p50,
             'p90',          f.p90,
             'sampleCount',  f.sample_count,
             'fittedAt',     now()
           )
      FROM fitted f
     WHERE c.id = f.customer_id
  `);
  return result.rowCount ?? 0;
}

export async function countCanonical(db: TenantDb): Promise<{
  transactions: number;
  invoices: number;
  customers: number;
  accountsNeedingReview: number;
}> {
  const [txn] = await db.select({ n: sql<number>`count(*)::int` }).from(transactions);
  const [inv] = await db.select({ n: sql<number>`count(*)::int` }).from(invoices);
  const [cus] = await db.select({ n: sql<number>`count(*)::int` }).from(customers);
  const [rev] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.needsReview, true));

  return {
    transactions: txn?.n ?? 0,
    invoices: inv?.n ?? 0,
    customers: cus?.n ?? 0,
    accountsNeedingReview: rev?.n ?? 0,
  };
}
