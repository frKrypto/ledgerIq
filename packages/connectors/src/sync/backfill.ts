import type { ConnectorAdapter, ConnectionRef, RawBatch } from '../adapter.js';
import type { RawPayloadArchive } from '../archive.js';

/**
 * Resumable backfill orchestration.
 *
 * A 24-month QuickBooks backfill behind a rate-limited API takes many minutes and
 * WILL be interrupted — deploys, OOM, provider 500s, a worker rescheduled by ECS.
 * Restarting from zero each time is not a recovery strategy; it is how a backfill
 * never completes for the customers with the most data, who are also the
 * customers who matter most.
 *
 * The ordering guarantee that makes resumption correct:
 *
 *     1. fetch page
 *     2. ARCHIVE page durably
 *     3. THEN advance the checkpoint
 *
 * If the process dies between 2 and 3 the page is re-fetched and re-archived, and
 * the archive's content-hash uniqueness makes that a no-op. If the checkpoint
 * were advanced first, a crash would skip a page permanently and leave a silent
 * hole in the customer's financial history — the kind of bug discovered months
 * later when a number doesn't tie out.
 *
 * At-least-once, never at-most-once. Duplicates are recoverable; gaps are not.
 */

export interface CheckpointStore {
  load(connectionId: string, recordType: string): Promise<CheckpointState | null>;
  save(connectionId: string, recordType: string, state: CheckpointState): Promise<void>;
}

export interface CheckpointState {
  readonly cursor: Record<string, unknown>;
  readonly recordsSeen: number;
  readonly phase: 'backfill' | 'incremental' | 'complete';
  readonly completedAt?: Date;
  readonly lastError?: string;
  readonly attemptCount?: number;
}

/** Records an archived page so it can be replayed and counted later. */
export interface PayloadRecorder {
  record(entry: {
    orgId: string;
    connectionId: string;
    recordType: string;
    objectKey: string;
    contentHash: string;
    byteSize: number;
    recordCount: number;
    pageIndex: number;
  }): Promise<void>;
}

export interface BackfillOptions {
  readonly since?: Date;
  readonly recordTypes?: readonly string[];
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BackfillProgress) => void;
  /** Test seam for injecting a crash at a chosen point. */
  readonly afterPage?: (batch: RawBatch) => Promise<void>;
}

export interface BackfillProgress {
  readonly recordType: string;
  readonly pageIndex: number;
  readonly recordsSeen: number;
  readonly recordTypesComplete: number;
  readonly recordTypesTotal: number;
}

export interface BackfillResult {
  readonly recordTypes: Record<string, { records: number; pages: number; complete: boolean }>;
  readonly totalRecords: number;
  readonly totalPages: number;
  readonly complete: boolean;
}

/** Default backfill window. 24 months is what seasonal decomposition needs. */
export const DEFAULT_BACKFILL_MONTHS = 24;

export function defaultSince(now = new Date()): Date {
  const since = new Date(now);
  since.setMonth(since.getMonth() - DEFAULT_BACKFILL_MONTHS);
  return since;
}

export class BackfillRunner {
  constructor(
    private readonly adapter: ConnectorAdapter,
    private readonly archive: RawPayloadArchive,
    private readonly checkpoints: CheckpointStore,
    private readonly recorder: PayloadRecorder,
  ) {}

  async run(connection: ConnectionRef, options: BackfillOptions = {}): Promise<BackfillResult> {
    const recordTypes = options.recordTypes ?? this.adapter.recordTypes;
    const since = options.since ?? defaultSince();

    const results: BackfillResult['recordTypes'] = {};
    let totalRecords = 0;
    let totalPages = 0;
    let completedTypes = 0;

    for (const recordType of recordTypes) {
      options.signal?.throwIfAborted();

      const existing = await this.checkpoints.load(connection.id, recordType);

      // Already finished on a previous run — skip without re-fetching. This is
      // what makes resumption cheap rather than merely possible.
      if (existing?.phase === 'complete') {
        results[recordType] = { records: existing.recordsSeen, pages: 0, complete: true };
        totalRecords += existing.recordsSeen;
        completedTypes += 1;
        continue;
      }

      const outcome = await this.#syncRecordType(connection, recordType, since, existing, options);

      results[recordType] = outcome;
      totalRecords += outcome.records;
      totalPages += outcome.pages;
      if (outcome.complete) completedTypes += 1;
    }

    return {
      recordTypes: results,
      totalRecords,
      totalPages,
      complete: completedTypes === recordTypes.length,
    };
  }

  async #syncRecordType(
    connection: ConnectionRef,
    recordType: string,
    since: Date,
    existing: CheckpointState | null,
    options: BackfillOptions,
  ): Promise<{ records: number; pages: number; complete: boolean }> {
    let recordsSeen = existing?.recordsSeen ?? 0;
    let pages = 0;
    // The furthest cursor durably checkpointed during THIS run. Without this the
    // failure path below writes back `existing.cursor` — the cursor from before
    // the run started — silently discarding every page already archived. That
    // does not cause gaps (the re-fetch dedupes), but it throws away real
    // progress and re-burns rate limit, which on a 24-month backfill of a large
    // company is the difference between resuming and effectively restarting.
    let latestCursor: Record<string, unknown> = existing?.cursor ?? {};

    const iterator = this.adapter.fullSync(connection, recordType, {
      since,
      ...(existing?.cursor ? { checkpoint: existing.cursor } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    try {
      for await (const batch of iterator) {
        options.signal?.throwIfAborted();

        // ── Step 2: archive durably, BEFORE advancing the checkpoint ──────────
        const archived = await this.archive.put({
          orgId: connection.orgId,
          connectionId: connection.id,
          recordType,
          payload: batch.rawResponse,
          // Dedupe on the records themselves. The provider envelope carries a
          // response timestamp, so hashing it would make every retry look like
          // a new page and defeat at-least-once delivery's safety.
          contentForHash: batch.records,
          pageIndex: batch.pageIndex,
        });

        await this.recorder.record({
          orgId: connection.orgId,
          connectionId: connection.id,
          recordType,
          objectKey: archived.objectKey,
          contentHash: archived.contentHash,
          byteSize: archived.byteSize,
          recordCount: batch.records.length,
          pageIndex: batch.pageIndex,
        });

        recordsSeen += batch.records.length;
        pages += 1;

        // Test seam: simulate a crash between archive and checkpoint. On resume
        // the page is re-fetched and re-archived, and the archive dedupes it.
        await options.afterPage?.(batch);

        // ── Step 3: only now is it safe to advance ────────────────────────────
        latestCursor = batch.cursor;
        await this.checkpoints.save(connection.id, recordType, {
          cursor: batch.cursor,
          recordsSeen,
          phase: batch.hasMore ? 'backfill' : 'complete',
          ...(batch.hasMore ? {} : { completedAt: new Date() }),
        });

        options.onProgress?.({
          recordType,
          pageIndex: batch.pageIndex,
          recordsSeen,
          recordTypesComplete: 0,
          recordTypesTotal: 0,
        });
      }

      return { records: recordsSeen, pages, complete: true };
    } catch (err) {
      // Persist the failure so the next attempt resumes rather than restarts, and
      // so repeated failures are visible instead of appearing as a stalled sync.
      await this.checkpoints.save(connection.id, recordType, {
        // The furthest point actually reached, not where the run began.
        cursor: latestCursor,
        recordsSeen,
        phase: 'backfill',
        lastError: (err as Error).message,
        attemptCount: (existing?.attemptCount ?? 0) + 1,
      });
      throw err;
    }
  }
}

/** In-memory checkpoint store for tests and local development. */
export class InMemoryCheckpointStore implements CheckpointStore {
  readonly #state = new Map<string, CheckpointState>();

  private key(connectionId: string, recordType: string): string {
    return `${connectionId}::${recordType}`;
  }

  load(connectionId: string, recordType: string): Promise<CheckpointState | null> {
    return Promise.resolve(this.#state.get(this.key(connectionId, recordType)) ?? null);
  }

  save(connectionId: string, recordType: string, state: CheckpointState): Promise<void> {
    this.#state.set(this.key(connectionId, recordType), state);
    return Promise.resolve();
  }
}

/** In-memory recorder that also detects duplicate archived pages. */
export class InMemoryPayloadRecorder implements PayloadRecorder {
  readonly entries: Array<{ recordType: string; contentHash: string; recordCount: number; pageIndex: number }> = [];

  record(entry: {
    recordType: string;
    contentHash: string;
    recordCount: number;
    pageIndex: number;
  }): Promise<void> {
    this.entries.push({
      recordType: entry.recordType,
      contentHash: entry.contentHash,
      recordCount: entry.recordCount,
      pageIndex: entry.pageIndex,
    });
    return Promise.resolve();
  }

  /** Unique pages by content hash — the deduplicated view. */
  get uniqueHashes(): Set<string> {
    return new Set(this.entries.map((e) => e.contentHash));
  }
}
