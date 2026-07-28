import type { Pool } from 'pg';
import {
  BackfillRunner,
  QuickBooksAdapter,
  defaultSince,
  type ConnectionRef,
} from '@ledgeriq/connectors';
import {
  withTenant,
  connectionsRepo,
  credentialsRepo,
  syncStateRepo,
  type TenantContext,
} from '@ledgeriq/db';
import { loadConfig, fmt, table } from '../context.js';

/**
 * `ledgeriq sync` — run a real backfill against a connected QuickBooks company.
 *
 * This is the point of the whole CLI: drive the actual ingestion pipeline against
 * real books, with database-backed checkpoints, and see what breaks. Every quirk
 * coded into the adapter so far came from documentation and a fake server. Real
 * data is the only way to find the rest.
 *
 * Interrupting this with Ctrl-C is a supported operation, not an accident —
 * re-running resumes from the database. That is worth exercising deliberately.
 */

interface SyncArgs {
  readonly connectionId: string;
  readonly recordTypes?: string[];
  readonly months?: number;
}

export async function sync(args: SyncArgs): Promise<void> {
  const config = await loadConfig({ requireQuickBooks: true });

  try {
    const owner = await resolveConnection(config.adminPool, args.connectionId);
    const ctx: TenantContext = {
      orgId: owner.orgId,
      actor: { type: 'system', jobName: 'cli-backfill' },
    };

    const credentials = await withTenant(config.pool, ctx, (db) =>
      credentialsRepo.readCredentials(db, config.kms, args.connectionId),
    );

    if (!credentials) {
      throw new Error(
        `No stored credentials for connection ${args.connectionId}. Run \`connect\` first.`,
      );
    }

    const adapter = new QuickBooksAdapter({
      clientId: config.quickbooks.clientId,
      clientSecret: config.quickbooks.clientSecret,
      sandbox: config.quickbooks.sandbox,
      ...(config.quickbooks.apiBase ? { apiBase: config.quickbooks.apiBase } : {}),
      ...(config.quickbooks.tokenUrl ? { tokenUrl: config.quickbooks.tokenUrl } : {}),
      // QBO rotates the refresh token on every refresh and invalidates the
      // previous one, so persisting the new pair is not optional bookkeeping —
      // dropping it strands the connection and forces the user to reconnect.
      onCredentialsRotated: async (connectionId, next) => {
        await withTenant(config.pool, ctx, (db) =>
          credentialsRepo.rotateCredentials(db, config.kms, connectionId, {
            accessToken: next.accessToken,
            refreshToken: next.refreshToken,
            expiresAt: next.expiresAt.toISOString(),
            ...(next.externalAccountId !== undefined
              ? { externalAccountId: next.externalAccountId }
              : {}),
          }),
        );
        console.log(fmt.dim('  ↻ refreshed and persisted rotated credentials'));
      },
    });

    const connection: ConnectionRef = {
      id: args.connectionId,
      orgId: owner.orgId,
      source: 'quickbooks',
      ...(owner.realmId !== null ? { externalAccountId: owner.realmId } : {}),
      credentials: {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: new Date(credentials.expiresAt),
        ...(credentials.externalAccountId !== undefined
          ? { externalAccountId: credentials.externalAccountId }
          : {}),
      },
    };

    const since = args.months
      ? new Date(new Date().setMonth(new Date().getMonth() - args.months))
      : defaultSince();

    const runner = new BackfillRunner(
      adapter,
      config.archive,
      new syncStateRepo.PostgresCheckpointStore(config.pool, ctx),
      new syncStateRepo.PostgresPayloadRecorder(config.pool, ctx),
    );

    // Ctrl-C aborts cleanly. Progress already checkpointed is kept; the page in
    // flight is simply re-fetched next time.
    const controller = new AbortController();
    const onSigint = (): void => {
      console.log(`\n${fmt.yellow('⚠')} Interrupted — checkpointed progress is saved.`);
      console.log(fmt.dim(`  Re-run the same command to resume.`));
      controller.abort();
    };
    process.on('SIGINT', onSigint);

    console.log(`\n${fmt.bold('Backfill')}  ${args.connectionId}`);
    console.log(fmt.dim(`  since ${since.toISOString().slice(0, 10)}`));
    console.log(fmt.dim(`  types ${(args.recordTypes ?? adapter.recordTypes).join(', ')}\n`));

    const started = Date.now();
    let lastType = '';

    try {
      const result = await runner.run(connection, {
        since,
        ...(args.recordTypes ? { recordTypes: args.recordTypes } : {}),
        signal: controller.signal,
        onProgress: (p) => {
          if (p.recordType !== lastType) {
            if (lastType) process.stdout.write('\n');
            process.stdout.write(`  ${p.recordType.padEnd(14)}`);
            lastType = p.recordType;
          }
          process.stdout.write(`\r  ${p.recordType.padEnd(14)} ${fmt.count(p.recordsSeen)} records`);
        },
      });

      process.stdout.write('\n');
      const seconds = ((Date.now() - started) / 1000).toFixed(1);

      console.log(
        `\n${result.complete ? fmt.green('✓') : fmt.yellow('~')} ` +
          `${fmt.count(result.totalRecords)} records across ${result.totalPages} pages in ${seconds}s\n`,
      );

      console.log(
        table(
          Object.entries(result.recordTypes).map(([type, r]) => ({
            type,
            records: fmt.count(r.records),
            pages: r.pages,
            status: r.complete ? fmt.green('complete') : fmt.yellow('partial'),
          })),
        ),
      );

      // Reconciliation against QBO's own COUNT(*). This is what catches the
      // failure mode a health check misses: a 200 response carrying subtly
      // incomplete data.
      console.log(`\n${fmt.bold('Reconciliation')}`);
      const reports = [];
      for (const [type, r] of Object.entries(result.recordTypes)) {
        const report = await adapter.reconcile(connection, type, r.records);
        reports.push({
          type,
          ours: fmt.count(report.ourCount),
          theirs: report.providerCount === null ? fmt.dim('—') : fmt.count(report.providerCount),
          match: report.providerCount === null
            ? fmt.dim('unknown')
            : report.divergent
              ? fmt.red('DIVERGENT')
              : fmt.green('ok'),
        });
      }
      console.log(table(reports));

      // Record the successful sync so the freshness indicator is truthful.
      //
      // Missing this was visible in the first smoke run: a completed backfill
      // still reported "last sync: never". Data freshness is rendered on every
      // product surface (architecture.md §7), and a stale-but-confident
      // timestamp is one of the failure modes the design explicitly guards
      // against — so it has to be written by whatever actually completes a sync,
      // not assumed.
      if (result.complete) {
        await withTenant(config.pool, ctx, (db) =>
          connectionsRepo.recordSuccessfulSync(db, args.connectionId),
        );
      }
      console.log();
    } finally {
      process.off('SIGINT', onSigint);
    }
  } finally {
    await config.pool.end();
    await config.adminPool.end();
  }
}

/**
 * Resolve which org owns a connection.
 *
 * Chicken-and-egg: we need the org to build a tenant scope, but the connection
 * row is only readable inside one. Resolved with a narrow admin-level lookup
 * returning nothing but the owning org id — the smallest possible read outside a
 * tenant scope, rather than widening the scope itself.
 */
async function resolveConnection(
  pool: Pool,
  connectionId: string,
): Promise<{ orgId: string; realmId: string | null }> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ org_id: string; realm_id: string | null }>(
      `SELECT org_id, realm_id FROM connections WHERE id = $1`,
      [connectionId],
    );
    const row = rows[0];
    if (!row) throw new Error(`No connection ${connectionId}`);
    return { orgId: row.org_id, realmId: row.realm_id };
  } finally {
    client.release();
  }
}
