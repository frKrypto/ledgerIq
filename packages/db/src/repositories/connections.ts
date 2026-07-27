import { and, eq, isNull, sql } from 'drizzle-orm';
import type { TenantDb } from '../tenant-context.js';
import { connections, syncRuns } from '../schema/index.js';

/**
 * Connection repository.
 *
 * Note the shape every repository in this codebase follows: the first parameter
 * is a `TenantDb`, which can only be obtained from `withTenant`. There is no
 * overload taking a raw pool, so there is no way to call these functions outside
 * a tenant scope — the isolation guarantee is carried by the type system rather
 * than by remembering to add a WHERE clause.
 *
 * Consequently these queries contain no `org_id` predicate. That is intentional:
 * RLS supplies it. Adding a redundant filter here would suggest the policy is
 * optional, and the day someone forgets it we would be relying on the habit
 * instead of the mechanism.
 */

export interface NewConnection {
  readonly source: (typeof connections.$inferInsert)['source'];
  readonly sourceKind: (typeof connections.$inferInsert)['sourceKind'];
  readonly displayName?: string;
  readonly externalAccountId?: string;
  readonly connectedBy?: string;
  readonly credentialsEncrypted?: string;
  readonly credentialsKeyId?: string;
  readonly scopesGranted?: string[];
}

export type Connection = typeof connections.$inferSelect;

export async function listConnections(db: TenantDb): Promise<Connection[]> {
  return db.select().from(connections).where(isNull(connections.disconnectedAt));
}

export async function getConnection(db: TenantDb, id: string): Promise<Connection | undefined> {
  const [row] = await db.select().from(connections).where(eq(connections.id, id)).limit(1);
  return row;
}

export async function createConnection(db: TenantDb, input: NewConnection): Promise<Connection> {
  // org_id comes from the tenant scope, never from caller input — a caller
  // cannot create a row attributed to another tenant even if it tries, because
  // the RLS WITH CHECK clause would reject it.
  const [row] = await db
    .insert(connections)
    .values({
      orgId: db.orgId,
      source: input.source,
      sourceKind: input.sourceKind,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.externalAccountId !== undefined
        ? { externalAccountId: input.externalAccountId }
        : {}),
      ...(input.connectedBy !== undefined ? { connectedBy: input.connectedBy } : {}),
      ...(input.credentialsEncrypted !== undefined
        ? { credentialsEncrypted: input.credentialsEncrypted }
        : {}),
      ...(input.credentialsKeyId !== undefined ? { credentialsKeyId: input.credentialsKeyId } : {}),
      ...(input.scopesGranted !== undefined ? { scopesGranted: input.scopesGranted } : {}),
    })
    .returning();

  if (!row) throw new Error('Insert returned no row');
  return row;
}

export async function markConnectionStatus(
  db: TenantDb,
  id: string,
  status: Connection['status'],
  detail?: string,
): Promise<void> {
  await db
    .update(connections)
    .set({ status, statusDetail: detail ?? null })
    .where(eq(connections.id, id));
}

export async function recordSuccessfulSync(db: TenantDb, id: string, cursor?: string): Promise<void> {
  await db
    .update(connections)
    .set({
      lastSuccessfulSyncAt: new Date(),
      status: 'active',
      statusDetail: null,
      ...(cursor !== undefined ? { syncCursor: cursor } : {}),
    })
    .where(eq(connections.id, id));
}

/**
 * Per-source data freshness — the value rendered on every product surface.
 *
 * Freshness is a first-class product concept, not an error state: a stale number
 * presented as current is one of the severe failure modes in architecture.md §9.
 */
export interface SourceFreshness {
  readonly sourceKind: Connection['sourceKind'];
  readonly lastSyncAt: Date | null;
  readonly hasDegradedConnection: boolean;
}

export async function getDataFreshness(db: TenantDb): Promise<SourceFreshness[]> {
  const rows = await db
    .select({
      sourceKind: connections.sourceKind,
      lastSyncAt: sql<Date | null>`max(${connections.lastSuccessfulSyncAt})`,
      hasDegradedConnection: sql<boolean>`bool_or(${connections.status} <> 'active')`,
    })
    .from(connections)
    .where(isNull(connections.disconnectedAt))
    .groupBy(connections.sourceKind);

  return rows.map((r) => ({
    sourceKind: r.sourceKind,
    lastSyncAt: r.lastSyncAt,
    hasDegradedConnection: r.hasDegradedConnection ?? false,
  }));
}

export async function listConnectionsNeedingReauth(db: TenantDb): Promise<Connection[]> {
  return db
    .select()
    .from(connections)
    .where(and(eq(connections.status, 'reauth_required'), isNull(connections.disconnectedAt)));
}

export type SyncRun = typeof syncRuns.$inferSelect;

export async function startSyncRun(
  db: TenantDb,
  connectionId: string,
  kind: 'full' | 'incremental' | 'webhook' | 'reconcile',
): Promise<SyncRun> {
  const [row] = await db
    .insert(syncRuns)
    .values({ orgId: db.orgId, connectionId, kind, status: 'running', startedAt: new Date() })
    .returning();
  if (!row) throw new Error('Insert returned no row');
  return row;
}
