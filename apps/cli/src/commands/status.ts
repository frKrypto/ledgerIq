
import { withTenant, syncStateRepo, type TenantContext } from '@ledgeriq/db';
import { loadConfig, fmt, table } from '../context.js';

/**
 * `ledgeriq status` — connections, freshness, and sync progress.
 *
 * Data freshness is a first-class product concept rather than an error state
 * (docs/03-engineering/architecture.md §7), so it is worth having a truthful view
 * of it from the very first ingestion run — before there is a UI to render it.
 */

export async function status(args: { orgName?: string } = {}): Promise<void> {
  const config = await loadConfig();

  try {
    const client = await config.adminPool.connect();
    let orgs: Array<{ id: string; name: string }>;
    try {
      const { rows } = await client.query<{ id: string; name: string }>(
        args.orgName
          ? `SELECT id, name FROM organizations WHERE name = $1 AND deleted_at IS NULL`
          : `SELECT id, name FROM organizations WHERE deleted_at IS NULL ORDER BY created_at`,
        args.orgName ? [args.orgName] : [],
      );
      orgs = rows;
    } finally {
      client.release();
    }

    if (orgs.length === 0) {
      console.log(`\n${fmt.dim('No organizations. Run `connect` first.')}\n`);
      return;
    }

    for (const org of orgs) {
      const ctx: TenantContext = {
        orgId: org.id,
        actor: { type: 'system', jobName: 'cli-status' },
      };

      console.log(`\n${fmt.bold(org.name)}  ${fmt.dim(org.id)}`);

      const connections = await withTenant(config.pool, ctx, (db) =>
        import('@ledgeriq/db').then((m) => m.connectionsRepo.listConnections(db)),
      );

      if (connections.length === 0) {
        console.log(fmt.dim('  no connections'));
        continue;
      }

      console.log(
        table(
          connections.map((c) => ({
            source: c.source,
            status:
              c.status === 'active'
                ? fmt.green(c.status)
                : c.status === 'reauth_required'
                  ? fmt.red(c.status)
                  : fmt.yellow(c.status),
            'last sync': c.lastSuccessfulSyncAt
              ? relative(c.lastSuccessfulSyncAt)
              : fmt.dim('never'),
            connection: fmt.dim(c.id),
          })),
        ),
      );

      for (const connection of connections) {
        const progress = await syncStateRepo.getSyncProgress(config.pool, ctx, connection.id);
        if (progress.length === 0) continue;

        console.log(`\n  ${fmt.dim(`sync progress — ${connection.source}`)}`);
        console.log(
          table(
            progress.map((p) => ({
              type: p.recordType,
              records: fmt.count(p.recordsArchived),
              pages: p.pages,
              phase: p.phase === 'complete' ? fmt.green(p.phase) : fmt.yellow(p.phase),
              error: p.lastError ? fmt.red(p.lastError.slice(0, 40)) : fmt.dim('—'),
            })),
          ),
        );
      }
    }
    console.log();
  } finally {
    await config.pool.end();
    await config.adminPool.end();
  }
}

function relative(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * `ledgeriq inspect` — dump archived records for one record type.
 *
 * This is the command that actually earns the CLI its place. Sprint 3 has to
 * design normalization against the shape of real QuickBooks data, and this is how
 * that shape gets looked at: real field names, real nulls, real chart-of-accounts
 * naming, rather than what the documentation implies.
 */
export async function inspect(args: {
  connectionId: string;
  recordType: string;
  limit?: number;
  fields?: boolean;
}): Promise<void> {
  const config = await loadConfig();

  try {
    const client = await config.adminPool.connect();
    let orgId: string;
    try {
      const { rows } = await client.query<{ org_id: string }>(
        `SELECT org_id FROM connections WHERE id = $1`,
        [args.connectionId],
      );
      if (!rows[0]) throw new Error(`No connection ${args.connectionId}`);
      orgId = rows[0].org_id;
    } finally {
      client.release();
    }

    const ctx: TenantContext = { orgId, actor: { type: 'system', jobName: 'cli-inspect' } };
    const pages = await syncStateRepo.listArchivedPayloads(
      config.pool,
      ctx,
      args.connectionId,
      args.recordType,
      args.limit ?? 3,
    );

    if (pages.length === 0) {
      console.log(`\n${fmt.dim(`No archived ${args.recordType} payloads.`)}\n`);
      return;
    }

    const records: Record<string, unknown>[] = [];
    for (const page of pages) {
      const payload = (await config.archive.get(page.objectKey)) as {
        QueryResponse?: Record<string, unknown>;
      };
      const found = payload.QueryResponse?.[args.recordType];
      if (Array.isArray(found)) records.push(...(found as Record<string, unknown>[]));
    }

    console.log(
      `\n${fmt.bold(args.recordType)}  ${fmt.dim(`${records.length} records from ${pages.length} archived page(s)`)}\n`,
    );

    if (args.fields) {
      // Field frequency across real records. Sparse fields are the normalization
      // hazard: a field present in 4% of records is one that will be null far
      // more often than the docs suggest.
      const frequency = new Map<string, number>();
      for (const record of records) {
        for (const key of Object.keys(record)) {
          frequency.set(key, (frequency.get(key) ?? 0) + 1);
        }
      }
      console.log(
        table(
          [...frequency.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([field, count]) => ({
              field,
              present: `${count}/${records.length}`,
              coverage: `${Math.round((count / records.length) * 100)}%`,
            })),
        ),
      );
    } else {
      console.log(JSON.stringify(records.slice(0, args.limit ?? 3), null, 2));
    }
    console.log();
  } finally {
    await config.pool.end();
    await config.adminPool.end();
  }
}
