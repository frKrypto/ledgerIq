import {
  parseQuickBooksProfitAndLoss,
  reconcileProfitAndLoss,
  formatReport,
  type QboProfitAndLoss,
} from '@ledgeriq/reconcile';
import { QuickBooksAdapter, type ConnectionRef } from '@ledgeriq/connectors';
import { connectionsRepo, credentialsRepo, withTenant, type TenantContext } from '@ledgeriq/db';
import { loadConfig, fmt, ConfigError } from '../context.js';

/**
 * `ledgeriq reconcile` — does our model agree with QuickBooks' own P&L?
 *
 * This is the Phase 1 gate made runnable. Point it at a connected company and it
 * answers the only question that matters before anything is built on top: are
 * the numbers right.
 *
 * It exits non-zero on divergence so it can be wired into CI or a nightly job
 * without anyone having to read the output to find out.
 */
export async function reconcile(args: {
  connectionId: string;
  start?: string;
  end?: string;
}): Promise<void> {
  const config = await loadConfig({ requireQuickBooks: true });

  try {
    const { rows } = await config.adminPool.query<{ org_id: string; name: string }>(
      `SELECT c.org_id, o.name FROM connections c
         JOIN organizations o ON o.id = c.org_id
        WHERE c.id = $1`,
      [args.connectionId],
    );
    const owner = rows[0];
    if (!owner) throw new ConfigError(`No connection ${args.connectionId}`);

    const ctx: TenantContext = {
      orgId: owner.org_id,
      actor: { type: 'system', jobName: 'reconcile' },
    };

    // Default to the last full calendar year ending last month. A partial current
    // month is a real source of spurious divergence — the source system and our
    // ledger can legitimately disagree at an open boundary.
    const endDate = args.end ? new Date(`${args.end}T00:00:00Z`) : (() => {
      const d = new Date();
      d.setUTCDate(0);
      return d;
    })();
    const startDate = args.start
      ? new Date(`${args.start}T00:00:00Z`)
      : new Date(Date.UTC(endDate.getUTCFullYear() - 1, endDate.getUTCMonth() + 1, 1));

    const start = startDate.toISOString().slice(0, 10);
    const end = endDate.toISOString().slice(0, 10);

    const stored = await withTenant(config.pool, ctx, async (db) => {
      const row = await connectionsRepo.getConnection(db, args.connectionId);
      const creds = await credentialsRepo.readCredentials(db, config.kms, args.connectionId);
      return { row, creds };
    });
    if (!stored.row) throw new ConfigError(`Connection ${args.connectionId} not readable`);
    if (!stored.creds) throw new ConfigError('No stored credentials for this connection');

    const adapter = new QuickBooksAdapter({
      clientId: config.quickbooks.clientId,
      clientSecret: config.quickbooks.clientSecret,
      sandbox: config.quickbooks.sandbox,
      ...(config.quickbooks.apiBase ? { apiBase: config.quickbooks.apiBase } : {}),
      ...(config.quickbooks.tokenUrl ? { tokenUrl: config.quickbooks.tokenUrl } : {}),
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
      },
    });

    const connection: ConnectionRef = {
      id: args.connectionId,
      orgId: owner.org_id,
      source: 'quickbooks',
      externalAccountId: stored.row.realmId ?? stored.creds.externalAccountId ?? '',
      credentials: {
        accessToken: stored.creds.accessToken,
        refreshToken: stored.creds.refreshToken,
        expiresAt: new Date(stored.creds.expiresAt),
        ...(stored.creds.externalAccountId !== undefined
          ? { externalAccountId: stored.creds.externalAccountId }
          : {}),
      },
    };

    console.log(`\n${fmt.bold(owner.name)}  ${fmt.dim(`${start} → ${end}`)}\n`);

    const raw = await adapter.fetchReport(connection, 'ProfitAndLoss', {
      start_date: start,
      end_date: end,
      accounting_method: 'Accrual',
    });

    const source = parseQuickBooksProfitAndLoss(raw as QboProfitAndLoss);
    const report = await reconcileProfitAndLoss(config.pool, owner.org_id, source);

    console.log(formatReport(report));
    console.log('');

    if (!report.ok) {
      // Non-zero, deliberately. A reconciler whose failure is only visible to
      // someone reading the output is a reconciler that stops being run.
      process.exitCode = 1;
    }
  } finally {
    await config.pool.end();
    await config.adminPool.end();
  }
}
