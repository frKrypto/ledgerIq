import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  BackfillRunner,
  HttpClient,
  QuickBooksAdapter,
  RateLimiter,
  type ConnectionRef,
} from '@ledgeriq/connectors';
import { startFakeQbo } from '@ledgeriq/connectors/test-helpers';
import { generateAgency } from '@ledgeriq/seed';
import {
  normalizeAccounts,
  normalizeExpenses,
  normalizeInvoices,
  normalizePayments,
  TRANSFORM_VERSION,
  type StatementClass,
} from '@ledgeriq/normalize';
import {
  withTenant,
  canonicalRepo,
  syncStateRepo,
  type TenantContext,
} from '@ledgeriq/db';
import { loadConfig, fmt } from '../context.js';

/**
 * `ledgeriq demo` — build a complete, working business from scratch.
 *
 * Generates a realistic 24-month agency, serves it from a fake QuickBooks
 * server, and pulls it through the ENTIRE real pipeline: adapter, rate limiter,
 * archive, checkpoints, normalization, canonical model. The only fake component
 * is Intuit.
 *
 * This exists because "testable" needs to mean something you can open and click,
 * and the metric engine cannot be evaluated against an empty database. It is a
 * seeded fixture, not a mock — every number the UI subsequently shows is
 * computed by the real engine from rows that travelled the real ingestion path.
 */

export async function demo(args: { orgName?: string; months?: number } = {}): Promise<void> {
  const config = await loadConfig();
  const orgName = args.orgName ?? 'Northwind Design';
  const months = args.months ?? 24;

  try {
    console.log(`\n${fmt.bold('Building demo business')}  ${orgName}`);

    // ── 1. Generate ────────────────────────────────────────────────────────
    const business = generateAgency({ months });
    const generated = Object.entries(business).reduce((s, [, v]) => s + v.length, 0);
    console.log(
      `  ${fmt.green('✓')} generated ${fmt.count(generated)} QuickBooks records over ${months} months`,
    );

    // ── 2. Serve from the fake QBO API ─────────────────────────────────────
    const qbo = await startFakeQbo({
      data: business as unknown as Record<string, unknown[]>,
    });

    try {
      // ── 3. Create org + connection ───────────────────────────────────────
      const { orgId, userId, connectionId } = await bootstrap(config.adminPool, orgName);
      const ctx: TenantContext = { orgId, actor: { type: 'system', jobName: 'demo' } };

      // ── 4. Ingest through the real pipeline ──────────────────────────────
      // Use the CONFIGURED archive, not a scratch directory. Writing to one
      // archive and replaying from another is how the first run of this command
      // failed: the pages were written to a temp dir and the normalizer looked
      // for them where the config said they should be.
      const archive = config.archive;

      const adapter = new QuickBooksAdapter({
        clientId: 'demo',
        clientSecret: 'demo',
        apiBase: qbo.url,
        tokenUrl: qbo.tokenUrl,
        httpClient: new HttpClient({
          provider: 'quickbooks',
          rateLimiter: new RateLimiter(2000, 2000),
          retry: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 50 },
        }),
      });

      const connection: ConnectionRef = {
        id: connectionId,
        orgId,
        source: 'quickbooks',
        externalAccountId: 'demo-realm',
        credentials: {
          accessToken: qbo.currentAccessToken,
          refreshToken: qbo.currentRefreshToken,
          expiresAt: new Date(Date.now() + 3600_000),
          externalAccountId: 'demo-realm',
        },
      };

      const recordTypes = ['Account', 'Customer', 'Vendor', 'Invoice', 'Payment', 'Purchase', 'Bill'];
      const runner = new BackfillRunner(
        adapter,
        archive,
        new syncStateRepo.PostgresCheckpointStore(config.pool, ctx),
        new syncStateRepo.PostgresPayloadRecorder(config.pool, ctx),
      );

      const result = await runner.run(connection, { recordTypes, since: sinceMonths(months) });
      console.log(
        `  ${fmt.green('✓')} ingested ${fmt.count(result.totalRecords)} records ` +
          `across ${result.totalPages} pages (archived + checkpointed)`,
      );

      // ── 5. Normalize from the ARCHIVE, not from memory ───────────────────
      // Deliberate: this is the replay path. If normalization can only run on
      // data still in memory from the fetch, then the archive is decorative and
      // a normalization bug six months from now is unfixable.
      const counts = await normalizeFromArchive(config, ctx, connectionId, recordTypes);
      console.log(
        `  ${fmt.green('✓')} normalized ${fmt.count(counts.transactions)} transactions, ` +
          `${fmt.count(counts.invoices)} invoices, ${counts.customers} customers`,
      );

      if (counts.accountsNeedingReview > 0) {
        console.log(
          `  ${fmt.yellow('!')} ${counts.accountsNeedingReview} account(s) need mapping review ` +
            fmt.dim('— exactly what onboarding would ask about'),
        );
      }

      // ── 6. Fit payment behaviour ─────────────────────────────────────────
      const fitted = await withTenant(config.pool, ctx, (db) =>
        canonicalRepo.refreshPaymentBehavior(db),
      );
      console.log(`  ${fmt.green('✓')} fitted payment behaviour for ${fitted} customers`);

      console.log(`\n${fmt.bold('Ready.')}`);
      console.log(`  org  ${fmt.dim(orgId)}`);
      console.log(`\n  ${fmt.cyan('npm run web')}   ${fmt.dim('→ http://localhost:4100')}\n`);
      void userId;
    } finally {
      await qbo.close();
    }
  } finally {
    await config.pool.end();
    await config.adminPool.end();
  }
}

function sinceMonths(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months - 1);
  return d;
}

/**
 * Re-read every archived page and normalize it.
 *
 * Order matters: accounts and customers first, because transactions reference
 * them. Getting this backwards produces transactions with null foreign keys and
 * silently unattributed revenue.
 */
async function normalizeFromArchive(
  config: Awaited<ReturnType<typeof loadConfig>>,
  ctx: TenantContext,
  connectionId: string,
  recordTypes: string[],
): Promise<{ transactions: number; invoices: number; customers: number; accountsNeedingReview: number }> {
  const byType = new Map<string, unknown[]>();

  for (const recordType of recordTypes) {
    const pages = await syncStateRepo.listArchivedPayloads(
      config.pool, ctx, connectionId, recordType, 1000,
    );
    const records: unknown[] = [];
    for (const page of pages) {
      const payload = (await config.archive.get(page.objectKey)) as {
        QueryResponse?: Record<string, unknown>;
      };
      const found = payload.QueryResponse?.[recordType];
      if (Array.isArray(found)) records.push(...found);
    }
    byType.set(recordType, records);
  }

  const { accounts } = normalizeAccounts(byType.get('Account') ?? []);
  const statementBySourceId = new Map<string, StatementClass | null>(
    accounts.map((a) => [a.sourceAccountId, a.statement]),
  );
  const nameBySourceId = new Map(accounts.map((a) => [a.sourceAccountId, a.name]));
  const categoryBySourceId = new Map(accounts.map((a) => [a.sourceAccountId, a.categoryKey]));
  const lookup = {
    statementFor: (id: string) => statementBySourceId.get(id) ?? null,
    nameFor: (id: string) => nameBySourceId.get(id) ?? null,
    categoryKeyFor: (id: string) => categoryBySourceId.get(id) ?? null,
  };

  const invoiceResult = normalizeInvoices(byType.get('Invoice') ?? []);
  const paymentResult = normalizePayments(byType.get('Payment') ?? []);
  const purchaseResult = normalizeExpenses(byType.get('Purchase') ?? [], 'Purchase', lookup);
  const billResult = normalizeExpenses(byType.get('Bill') ?? [], 'Bill', lookup);

  const customerRecords = (byType.get('Customer') ?? []).map((raw) => {
    const c = raw as { Id?: string; DisplayName?: string; PrimaryEmailAddr?: { Address?: string } };
    return {
      sourceId: c.Id ?? '',
      name: c.DisplayName ?? 'Unknown',
      ...(c.PrimaryEmailAddr?.Address ? { email: c.PrimaryEmailAddr.Address } : {}),
    };
  }).filter((c) => c.sourceId);

  return withTenant(config.pool, ctx, async (db) => {
    const ledgerMap = await canonicalRepo.upsertLedgerAccounts(db, accounts);
    const customerMap = await canonicalRepo.upsertCustomers(db, customerRecords);
    const categoryMap = await canonicalRepo.loadCategoryMap(db);

    await canonicalRepo.upsertInvoices(db, invoiceResult.invoices, customerMap);
    await canonicalRepo.upsertTransactions(
      db,
      [
        ...invoiceResult.transactions,
        ...paymentResult.transactions,
        ...purchaseResult.transactions,
        ...billResult.transactions,
      ],
      { ledgerAccounts: ledgerMap, customers: customerMap, categories: categoryMap },
      TRANSFORM_VERSION,
    );

    return canonicalRepo.countCanonical(db);
  });
}

async function bootstrap(
  pool: Pool,
  orgName: string,
): Promise<{ orgId: string; userId: string; connectionId: string }> {
  const client = await pool.connect();
  try {
    // Rebuild cleanly so `demo` is repeatable rather than accumulating.
    await client.query(`DELETE FROM organizations WHERE name = $1`, [orgName]);

    const org = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, business_model, naics_code, employee_count, onboarding_stage, activated_at)
       VALUES ($1, 'services', '541810', 22, 'active', now()) RETURNING id`,
      [orgName],
    );
    const orgId = org.rows[0]?.id;
    if (!orgId) throw new Error('failed to create org');

    const user = await client.query<{ id: string }>(
      `INSERT INTO users (external_auth_id, email, full_name)
       VALUES ($1, $2, 'Dana Whitfield') RETURNING id`,
      [`demo_${randomUUID()}`, `dana+${randomUUID().slice(0, 8)}@example.com`],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error('failed to create user');

    await client.query(
      `INSERT INTO memberships (org_id, user_id, role, accepted_at) VALUES ($1,$2,'owner',now())`,
      [orgId, userId],
    );

    const conn = await client.query<{ id: string }>(
      `INSERT INTO connections (org_id, source, source_kind, display_name, external_account_id, realm_id, connected_by, last_successful_sync_at)
       VALUES ($1,'quickbooks','accounting','QuickBooks Online','demo-realm','demo-realm',$2, now())
       RETURNING id`,
      [orgId, userId],
    );
    const connectionId = conn.rows[0]?.id;
    if (!connectionId) throw new Error('failed to create connection');

    return { orgId, userId, connectionId };
  } finally {
    client.release();
  }
}
