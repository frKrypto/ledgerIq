import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BackfillRunner,
  FileSystemArchive,
  HttpClient,
  QuickBooksAdapter,
  RateLimiter,
  type ConnectionRef,
} from '@ledgeriq/connectors';
import { startFakeQbo, makeRecords, FAKE_REALM_ID } from '@ledgeriq/connectors/test-helpers';
import { setupTestDatabase, seedTwoTenants, type TestDatabase } from './helpers/database.js';
import {
  PostgresCheckpointStore,
  PostgresPayloadRecorder,
  getSyncProgress,
} from '../src/repositories/sync-state.js';
import type { TenantContext } from '../src/tenant-context.js';

/**
 * Postgres-backed sync state.
 *
 * The backfill test in @ledgeriq/connectors proves resumption survives a crash
 * *within* a run, using in-memory checkpoints. That is the weaker claim. This
 * file proves the one that matters operationally: progress survives the process
 * itself going away, because it lives in the database.
 *
 * The distinction is not academic — deploys, ECS rescheduling, and OOM kills all
 * destroy in-memory state, and they are the common interruption in production,
 * not the exception.
 */

let db: TestDatabase;
let tenants: Awaited<ReturnType<typeof seedTwoTenants>>;
let archiveDir: string;
let ctxA: TenantContext;

beforeAll(async () => {
  db = await setupTestDatabase();
  tenants = await seedTwoTenants(db.adminPool);
  archiveDir = await mkdtemp(join(tmpdir(), 'lq-sync-'));
  ctxA = { orgId: tenants.orgA, actor: { type: 'system', jobName: 'backfill-test' } };
}, 60_000);

afterAll(async () => {
  await db?.close();
  await rm(archiveDir, { recursive: true, force: true });
});

describe('checkpoint persistence', () => {
  it('round-trips a checkpoint through the database', async () => {
    const store = new PostgresCheckpointStore(db.appPool, ctxA);

    expect(await store.load(tenants.connectionA, 'Invoice')).toBeNull();

    await store.save(tenants.connectionA, 'Invoice', {
      cursor: { startPosition: 501, pageIndex: 1 },
      recordsSeen: 500,
      phase: 'backfill',
    });

    const loaded = await store.load(tenants.connectionA, 'Invoice');
    expect(loaded?.cursor).toEqual({ startPosition: 501, pageIndex: 1 });
    expect(loaded?.recordsSeen).toBe(500);
    expect(loaded?.phase).toBe('backfill');
  });

  it('upserts rather than duplicating on repeated saves', async () => {
    const store = new PostgresCheckpointStore(db.appPool, ctxA);

    for (let i = 1; i <= 5; i++) {
      await store.save(tenants.connectionA, 'Customer', {
        cursor: { startPosition: i * 500 + 1, pageIndex: i },
        recordsSeen: i * 500,
        phase: 'backfill',
      });
    }

    const { rows } = await db.adminPool.query<{ n: string }>(
      `SELECT count(*) AS n FROM sync_checkpoints
        WHERE connection_id = $1 AND record_type = 'Customer'`,
      [tenants.connectionA],
    );
    expect(Number(rows[0]?.n)).toBe(1);

    const loaded = await store.load(tenants.connectionA, 'Customer');
    expect(loaded?.recordsSeen).toBe(2500);
  });

  it("cannot read another tenant's checkpoints", async () => {
    const storeB = new PostgresCheckpointStore(db.appPool, {
      orgId: tenants.orgB,
      actor: { type: 'system', jobName: 'backfill-test' },
    });

    // Tenant A wrote this row above; tenant B must not see it even naming the id.
    expect(await storeB.load(tenants.connectionA, 'Invoice')).toBeNull();
  });
});

describe('payload recording', () => {
  it('deduplicates a re-recorded page by content hash', async () => {
    const recorder = new PostgresPayloadRecorder(db.appPool, ctxA);
    const entry = {
      orgId: tenants.orgA,
      connectionId: tenants.connectionA,
      recordType: 'Bill',
      objectKey: 'org/conn/Bill/2026/07/27/abc.json.gz',
      contentHash: 'a'.repeat(64),
      byteSize: 1234,
      recordCount: 500,
      pageIndex: 0,
    };

    // Recording the same page twice is exactly what happens on the retry path
    // after a crash between archive and checkpoint.
    await recorder.record(entry);
    await recorder.record(entry);

    const { rows } = await db.adminPool.query<{ n: string }>(
      `SELECT count(*) AS n FROM raw_payloads WHERE connection_id = $1 AND record_type = 'Bill'`,
      [tenants.connectionA],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe('resumption across a process restart — the real acceptance criterion', () => {
  it('a second, entirely fresh runner resumes from database state', async () => {
    // A dedicated connection. Earlier tests in this file write checkpoints for
    // connectionA/Invoice, and inheriting one would make this test start
    // mid-stream — which is exactly how it first failed, reporting 2000 of 2500
    // records because pages 1-500 were never requested.
    const { rows } = await db.adminPool.query<{ id: string }>(
      `INSERT INTO connections (org_id, source, source_kind, display_name)
       VALUES ($1, 'quickbooks', 'accounting', 'Resumption Fixture') RETURNING id`,
      [tenants.orgA],
    );
    const connectionId = rows[0]?.id;
    if (!connectionId) throw new Error('failed to seed connection');

    const qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 2500) } });

    const makeAdapter = () =>
      new QuickBooksAdapter({
        clientId: 'test',
        clientSecret: 'test',
        apiBase: qbo.url,
        tokenUrl: qbo.tokenUrl,
        httpClient: new HttpClient({
          provider: 'quickbooks',
          rateLimiter: new RateLimiter(1000, 1000),
          retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
        }),
      });

    const connection: ConnectionRef = {
      id: connectionId,
      orgId: tenants.orgA,
      source: 'quickbooks',
      externalAccountId: FAKE_REALM_ID,
      credentials: {
        accessToken: qbo.currentAccessToken,
        refreshToken: qbo.currentRefreshToken,
        expiresAt: new Date(Date.now() + 3600_000),
        externalAccountId: FAKE_REALM_ID,
      },
    };

    const archive = new FileSystemArchive(archiveDir);

    try {
      // ── "Process" 1: crash after two pages. Every object below is discarded
      //    afterwards, simulating the process going away entirely. ────────────
      const runner1 = new BackfillRunner(
        makeAdapter(),
        archive,
        new PostgresCheckpointStore(db.appPool, ctxA),
        new PostgresPayloadRecorder(db.appPool, ctxA),
      );

      let pages = 0;
      await expect(
        runner1.run(connection, {
          recordTypes: ['Invoice'],
          afterPage: async () => {
            pages += 1;
            if (pages === 2) throw new Error('process killed');
            await Promise.resolve();
          },
        }),
      ).rejects.toThrow('process killed');

      const requestsBeforeRestart = qbo.requestCount;

      // ── "Process" 2: brand-new runner, store, and recorder. Nothing is shared
      //    with process 1 except the database and the archive. ────────────────
      const runner2 = new BackfillRunner(
        makeAdapter(),
        new FileSystemArchive(archiveDir),
        new PostgresCheckpointStore(db.appPool, ctxA),
        new PostgresPayloadRecorder(db.appPool, ctxA),
      );

      const resumed = await runner2.run(connection, { recordTypes: ['Invoice'] });
      expect(resumed.complete).toBe(true);

      // It resumed rather than restarting: a full re-run would have cost 6
      // requests, and resuming from page 1 costs fewer.
      const requestsAfterRestart = qbo.requestCount - requestsBeforeRestart;
      expect(requestsAfterRestart).toBeLessThan(6);

      // No gaps: every one of the 2500 records is in the archive index exactly
      // once, across both "processes".
      const counts = await db.adminPool.query<{ pages: string; records: string }>(
        `SELECT count(*) AS pages, coalesce(sum(record_count), 0) AS records
           FROM raw_payloads
          WHERE connection_id = $1 AND record_type = 'Invoice'`,
        [connectionId],
      );
      expect(Number(counts.rows[0]?.records)).toBe(2500);
      // 5 data pages + the empty page that signals exhaustion, deduplicated.
      expect(Number(counts.rows[0]?.pages)).toBe(6);

      // Decoy: another record type on this same connection. A degenerate
      // correlated subquery folds this into the Invoice totals — which is
      // exactly how the first implementation was caught.
      await db.adminPool.query(
        `INSERT INTO sync_checkpoints (org_id, connection_id, record_type, phase, records_seen)
         VALUES ($1, $2, 'Vendor', 'complete', 7)`,
        [tenants.orgA, connectionId],
      );
      await db.adminPool.query(
        `INSERT INTO raw_payloads
           (org_id, connection_id, object_key, content_hash, byte_size, record_type, record_count)
         VALUES ($1, $2, 'decoy', $3, 10, 'Vendor', 7)`,
        [tenants.orgA, connectionId, 'd'.repeat(64)],
      );

      const progress = await getSyncProgress(db.appPool, ctxA, connectionId);
      const invoice = progress.find((p) => p.recordType === 'Invoice');
      expect(invoice?.phase).toBe('complete');
      // The authoritative, deduplicated count. `recordsSeen` legitimately
      // over-counts here: the page archived but not checkpointed before the
      // crash is re-fetched and re-counted on resume. At-least-once delivery
      // guarantees no gaps, not exactly-once counting.
      expect(invoice?.recordsArchived).toBe(2500);
      expect(invoice?.recordsSeen).toBeGreaterThanOrEqual(2500);
      expect(invoice?.pages).toBe(6);
      // The decoy stays in its own row rather than contaminating Invoice.
      const vendor = progress.find((p) => p.recordType === 'Vendor');
      expect(vendor?.recordsArchived).toBe(7);
    } finally {
      await qbo.close();
    }
  }, 30_000);
});
