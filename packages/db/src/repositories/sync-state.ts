import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type {
  CheckpointState,
  CheckpointStore,
  PayloadRecorder,
} from '@ledgeriq/connectors';
import { withTenant, type TenantContext } from '../tenant-context.js';
import { rawPayloads, syncCheckpoints } from '../schema/index.js';

/**
 * Postgres-backed sync state.
 *
 * These replace the in-memory implementations that shipped with the backfill
 * runner. That distinction matters more than it sounds: with in-memory
 * checkpoints, a backfill survives a crash *within* a run but not a process
 * restart — and a process restart is the common case in production (deploys, ECS
 * rescheduling, OOM). The resumability guarantee was architecturally real and
 * operationally absent until this file existed.
 *
 * Each operation opens its own tenant-scoped transaction rather than joining a
 * caller's. That is deliberate: a checkpoint must become durable independently of
 * whatever else the caller is doing. Enrolling it in a longer transaction would
 * mean an unrelated later failure rolls back progress the backfill has genuinely
 * made, and the next attempt re-fetches pages it already archived.
 */

export class PostgresCheckpointStore implements CheckpointStore {
  constructor(
    private readonly pool: Pool,
    private readonly ctx: TenantContext,
  ) {}

  async load(connectionId: string, recordType: string): Promise<CheckpointState | null> {
    return withTenant(this.pool, this.ctx, async (db) => {
      const [row] = await db
        .select()
        .from(syncCheckpoints)
        .where(
          and(
            eq(syncCheckpoints.connectionId, connectionId),
            eq(syncCheckpoints.recordType, recordType),
          ),
        )
        .limit(1);

      if (!row) return null;

      return {
        cursor: row.cursor as Record<string, unknown>,
        recordsSeen: row.recordsSeen,
        phase: row.phase as CheckpointState['phase'],
        ...(row.completedAt ? { completedAt: row.completedAt } : {}),
        ...(row.lastError ? { lastError: row.lastError } : {}),
        attemptCount: row.attemptCount,
      };
    });
  }

  async save(connectionId: string, recordType: string, state: CheckpointState): Promise<void> {
    await withTenant(this.pool, this.ctx, async (db) => {
      // Upsert rather than select-then-write: two workers picking up the same
      // connection would otherwise race and one would lose its progress.
      await db
        .insert(syncCheckpoints)
        .values({
          orgId: this.ctx.orgId,
          connectionId,
          recordType,
          phase: state.phase,
          cursor: state.cursor,
          recordsSeen: state.recordsSeen,
          completedAt: state.completedAt ?? null,
          lastError: state.lastError ?? null,
          attemptCount: state.attemptCount ?? 0,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [syncCheckpoints.connectionId, syncCheckpoints.recordType],
          set: {
            phase: state.phase,
            cursor: state.cursor,
            recordsSeen: state.recordsSeen,
            completedAt: state.completedAt ?? null,
            lastError: state.lastError ?? null,
            attemptCount: state.attemptCount ?? 0,
            updatedAt: new Date(),
          },
        });
    });
  }
}

export class PostgresPayloadRecorder implements PayloadRecorder {
  constructor(
    private readonly pool: Pool,
    private readonly ctx: TenantContext,
    private readonly syncRunId?: string,
  ) {}

  async record(entry: {
    orgId: string;
    connectionId: string;
    recordType: string;
    objectKey: string;
    contentHash: string;
    byteSize: number;
    recordCount: number;
    pageIndex: number;
  }): Promise<void> {
    await withTenant(this.pool, this.ctx, async (db) => {
      // A re-fetched page after a crash produces the same content hash, so
      // recording it again is a no-op rather than a duplicate row. This is the
      // database half of the at-least-once guarantee — the archive dedupes the
      // object, this dedupes the index entry.
      await db
        .insert(rawPayloads)
        .values({
          orgId: entry.orgId,
          connectionId: entry.connectionId,
          syncRunId: this.syncRunId ?? null,
          objectKey: entry.objectKey,
          contentHash: entry.contentHash,
          byteSize: entry.byteSize,
          recordType: entry.recordType,
          recordCount: entry.recordCount,
          pageIndex: entry.pageIndex,
        })
        .onConflictDoNothing({
          target: [rawPayloads.connectionId, rawPayloads.recordType, rawPayloads.contentHash],
        });
    });
  }
}

/**
 * Per-record-type progress, for the CLI and later the onboarding progress UI.
 *
 * Two counts, deliberately, because they answer different questions:
 *
 *   recordsArchived — authoritative. Summed from raw_payloads, which is
 *                     deduplicated by content hash, so it is what actually
 *                     landed.
 *   recordsSeen     — the checkpoint's running counter. After a resume it
 *                     OVER-COUNTS, because the page that was archived but not
 *                     checkpointed gets re-fetched and re-counted. That is
 *                     inherent to at-least-once delivery, not a defect to fix in
 *                     the counter.
 *
 * Anything user-facing must use recordsArchived. Reporting "3,000 records" for a
 * company that has 2,500 would be a small lie that costs exactly the trust this
 * product is built to earn.
 */
export interface SyncProgressRow {
  readonly recordType: string;
  readonly phase: string;
  readonly recordsArchived: number;
  readonly recordsSeen: number;
  readonly pages: number;
  readonly completedAt: Date | null;
  readonly lastError: string | null;
}

export async function getSyncProgress(
  pool: Pool,
  ctx: TenantContext,
  connectionId: string,
): Promise<SyncProgressRow[]> {
  return withTenant(pool, ctx, async (db) => {
    // Deliberately an explicit LEFT JOIN + GROUP BY rather than correlated
    // subqueries.
    //
    // The subquery version of this was WRONG in a way that is easy to miss and
    // hard to spot in review: the outer column references rendered unqualified,
    // so inside `raw_payloads rp` they bound to rp's own columns and both
    // predicates became tautologies. Every record type's rows were summed into
    // every row of the result. It reported 3,000 records for a company with
    // 2,500, and only surfaced because a test happened to have another record
    // type present as decoy data.
    //
    // A join cannot degenerate this way — the ON clause names both sides.
    const rows = await db
      .select({
        recordType: syncCheckpoints.recordType,
        phase: syncCheckpoints.phase,
        recordsSeen: syncCheckpoints.recordsSeen,
        completedAt: syncCheckpoints.completedAt,
        lastError: syncCheckpoints.lastError,
        pages: sql<number>`count(${rawPayloads.id})::int`,
        recordsArchived: sql<number>`coalesce(sum(${rawPayloads.recordCount}), 0)::int`,
      })
      .from(syncCheckpoints)
      .leftJoin(
        rawPayloads,
        and(
          eq(rawPayloads.connectionId, syncCheckpoints.connectionId),
          eq(rawPayloads.recordType, syncCheckpoints.recordType),
        ),
      )
      .where(eq(syncCheckpoints.connectionId, connectionId))
      .groupBy(
        syncCheckpoints.recordType,
        syncCheckpoints.phase,
        syncCheckpoints.recordsSeen,
        syncCheckpoints.completedAt,
        syncCheckpoints.lastError,
      );

    return rows.map((r) => ({
      recordType: r.recordType,
      phase: r.phase,
      recordsArchived: r.recordsArchived ?? 0,
      recordsSeen: r.recordsSeen,
      pages: r.pages ?? 0,
      completedAt: r.completedAt,
      lastError: r.lastError,
    }));
  });
}

/** Archived pages for one record type, newest first — the replay entry point. */
export async function listArchivedPayloads(
  pool: Pool,
  ctx: TenantContext,
  connectionId: string,
  recordType: string,
  limit = 50,
): Promise<Array<{ objectKey: string; recordCount: number; pageIndex: number | null }>> {
  return withTenant(pool, ctx, async (db) => {
    return db
      .select({
        objectKey: rawPayloads.objectKey,
        recordCount: rawPayloads.recordCount,
        pageIndex: rawPayloads.pageIndex,
      })
      .from(rawPayloads)
      .where(
        and(eq(rawPayloads.connectionId, connectionId), eq(rawPayloads.recordType, recordType)),
      )
      .limit(limit);
  });
}
