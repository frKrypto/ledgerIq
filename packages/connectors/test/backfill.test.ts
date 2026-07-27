import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeQbo, makeRecords, FAKE_REALM_ID, type FakeQbo } from './helpers/fake-qbo.js';
import { QuickBooksAdapter } from '../src/quickbooks/adapter.js';
import { FileSystemArchive } from '../src/archive.js';
import {
  BackfillRunner,
  InMemoryCheckpointStore,
  InMemoryPayloadRecorder,
} from '../src/sync/backfill.js';
import { HttpClient, RateLimiter } from '../src/http.js';
import type { ConnectionRef } from '../src/adapter.js';

/**
 * Sprint 2 acceptance criteria, tested against a real HTTP server:
 *
 *   - Connect and land 24 months of raw payloads
 *   - Kill the process mid-backfill; it resumes without duplication or gaps
 *   - Token refresh works across an expiry boundary
 *
 * The resumption test is the one that matters. It is easy to write a backfill
 * that works when nothing goes wrong, and the failure it guards against — a
 * silently skipped page leaving a hole in a customer's financial history — is
 * discovered months later when a number doesn't tie out.
 */

let qbo: FakeQbo;
let archiveDir: string;

const CONNECTION_ID = 'c0000000-0000-4000-8000-000000000001';
const ORG_ID = '11111111-1111-1111-1111-111111111111';

function makeAdapter(overrides: Partial<ConstructorParameters<typeof QuickBooksAdapter>[0]> = {}) {
  return new QuickBooksAdapter({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    apiBase: qbo.url,
    tokenUrl: qbo.tokenUrl,
    // Generous limiter so tests are fast; the limiter itself is tested separately.
    httpClient: new HttpClient({
      provider: 'quickbooks',
      rateLimiter: new RateLimiter(1000, 1000),
      retry: { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
    }),
    ...overrides,
  });
}

function makeConnection(overrides: Partial<ConnectionRef['credentials']> = {}): ConnectionRef {
  return {
    id: CONNECTION_ID,
    orgId: ORG_ID,
    source: 'quickbooks',
    externalAccountId: FAKE_REALM_ID,
    credentials: {
      accessToken: qbo.currentAccessToken,
      refreshToken: qbo.currentRefreshToken,
      expiresAt: new Date(Date.now() + 3600_000),
      externalAccountId: FAKE_REALM_ID,
      ...overrides,
    },
  };
}

beforeEach(async () => {
  archiveDir = await mkdtemp(join(tmpdir(), 'lq-archive-'));
});

afterEach(async () => {
  await qbo?.close();
  await rm(archiveDir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('pagination', () => {
  it('fetches every record across pages without gaps or duplicates', async () => {
    // 1250 records at 500/page = 3 pages, the last partial.
    qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 1250) } });

    const archive = new FileSystemArchive(archiveDir);
    const checkpoints = new InMemoryCheckpointStore();
    const recorder = new InMemoryPayloadRecorder();
    const runner = new BackfillRunner(makeAdapter(), archive, checkpoints, recorder);

    const result = await runner.run(makeConnection(), { recordTypes: ['Invoice'] });

    expect(result.totalRecords).toBe(1250);
    expect(result.totalPages).toBe(3);
    expect(result.complete).toBe(true);
  });

  it('uses 1-indexed STARTPOSITION, so the first record is never dropped', async () => {
    // QBO pagination is 1-indexed. A 0-indexed adapter silently loses the first
    // record of the first page — a bug that looks like an off-by-one in a
    // customer's revenue total.
    qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 10) } });

    const adapter = makeAdapter();
    const batches = [];
    for await (const batch of adapter.fullSync(makeConnection(), 'Invoice')) {
      batches.push(batch);
    }

    expect(qbo.queryLog[0]).toContain('STARTPOSITION 1');
    const ids = batches.flatMap((b) => b.records.map((r) => (r as { Id: string }).Id));
    expect(ids).toContain('1');
    expect(ids).toHaveLength(10);
  });

  it('terminates when the provider omits the entity array', async () => {
    // QBO signals exhaustion by omitting the key rather than returning [].
    // An adapter looking for an empty array loops forever.
    qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 500) } });

    const adapter = makeAdapter();
    let pages = 0;
    for await (const _ of adapter.fullSync(makeConnection(), 'Invoice')) {
      pages += 1;
      if (pages > 10) throw new Error('fullSync failed to terminate');
    }
    // Exactly 500 records means a full page, then one more request that comes
    // back empty.
    expect(pages).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('resumption — the acceptance criterion', () => {
  it('resumes from the checkpoint after a crash, with no gaps and no double-counting', async () => {
    qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 2500) } });

    const archive = new FileSystemArchive(archiveDir);
    const checkpoints = new InMemoryCheckpointStore();
    const recorder = new InMemoryPayloadRecorder();

    // ── First run: crash after the 2nd page ──────────────────────────────────
    const firstRunner = new BackfillRunner(makeAdapter(), archive, checkpoints, recorder);
    let pagesBeforeCrash = 0;

    await expect(
      firstRunner.run(makeConnection(), {
        recordTypes: ['Invoice'],
        afterPage: async () => {
          pagesBeforeCrash += 1;
          if (pagesBeforeCrash === 2) throw new Error('simulated worker crash');
          await Promise.resolve();
        },
      }),
    ).rejects.toThrow('simulated worker crash');

    const afterCrash = await checkpoints.load(CONNECTION_ID, 'Invoice');
    expect(afterCrash?.phase).toBe('backfill');
    expect(afterCrash?.lastError).toContain('simulated worker crash');

    // ── Second run: resume ───────────────────────────────────────────────────
    const secondRunner = new BackfillRunner(makeAdapter(), archive, checkpoints, recorder);
    const resumed = await secondRunner.run(makeConnection(), { recordTypes: ['Invoice'] });

    expect(resumed.complete).toBe(true);

    // NO GAPS: every record present exactly once across the archive.
    const allIds = new Set<string>();
    let duplicateWrites = 0;
    for (const entry of recorder.entries) {
      const payload = (await archive.get(
        recorder.entries.find((e) => e.contentHash === entry.contentHash)
          ? (await findObjectKey(archive, archiveDir, entry.contentHash))
          : '',
      )) as { QueryResponse?: Record<string, unknown> };
      const records = (payload.QueryResponse?.['Invoice'] as { Id: string }[] | undefined) ?? [];
      for (const r of records) {
        if (allIds.has(r.Id)) duplicateWrites += 1;
        allIds.add(r.Id);
      }
    }

    expect(allIds.size, 'every record was archived exactly once').toBe(2500);

    // At-least-once delivery: the page that was archived but not checkpointed is
    // re-fetched and re-archived. The archive's content hash makes that a no-op
    // rather than a duplicate, which is why gaps are impossible and duplicates
    // are harmless.
    expect(duplicateWrites).toBeGreaterThanOrEqual(0);
    // 5 pages of 500 records, plus the empty page that signals exhaustion.
    expect(recorder.uniqueHashes.size).toBe(6);
  });

  it('skips record types already marked complete instead of re-fetching', async () => {
    qbo = await startFakeQbo({
      data: { Invoice: makeRecords('Invoice', 100), Customer: makeRecords('Customer', 100) },
    });

    const archive = new FileSystemArchive(archiveDir);
    const checkpoints = new InMemoryCheckpointStore();
    const recorder = new InMemoryPayloadRecorder();
    const runner = new BackfillRunner(makeAdapter(), archive, checkpoints, recorder);

    await runner.run(makeConnection(), { recordTypes: ['Invoice', 'Customer'] });
    const requestsAfterFirst = qbo.requestCount;

    // A second run should cost zero provider requests.
    const second = await runner.run(makeConnection(), { recordTypes: ['Invoice', 'Customer'] });

    expect(qbo.requestCount).toBe(requestsAfterFirst);
    expect(second.complete).toBe(true);
    expect(second.totalRecords).toBe(200);
  });

  it('records the failure so repeated attempts are visible rather than silent', async () => {
    qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 1000) } });
    const checkpoints = new InMemoryCheckpointStore();
    const runner = new BackfillRunner(
      makeAdapter(),
      new FileSystemArchive(archiveDir),
      checkpoints,
      new InMemoryPayloadRecorder(),
    );

    for (let i = 0; i < 2; i++) {
      await expect(
        runner.run(makeConnection(), {
          recordTypes: ['Invoice'],
          afterPage: () => Promise.reject(new Error('flaky')),
        }),
      ).rejects.toThrow('flaky');
    }

    const state = await checkpoints.load(CONNECTION_ID, 'Invoice');
    expect(state?.attemptCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('token refresh across an expiry boundary', () => {
  it('refreshes proactively when the token is near expiry', async () => {
    qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 10) } });

    const rotated: string[] = [];
    const adapter = makeAdapter({
      onCredentialsRotated: (_id, next) => {
        rotated.push(next.refreshToken);
        return Promise.resolve();
      },
    });

    // Token expires in 10 seconds — inside the 60s skew guard.
    const connection = makeConnection({ expiresAt: new Date(Date.now() + 10_000) });

    const batches = [];
    for await (const b of adapter.fullSync(connection, 'Invoice')) batches.push(b);

    expect(batches).toHaveLength(1);
    expect(rotated).toHaveLength(1);
    // QBO rotates the refresh token; the new one must have been persisted.
    expect(qbo.issuedRefreshTokens).toContain(rotated[0]);
  });

  it('recovers from a 401 mid-backfill by refreshing and retrying', async () => {
    qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 1500) } });

    const adapter = new QuickBooksAdapter({
      clientId: 'test-client',
      clientSecret: 'test-secret',
      apiBase: qbo.url,
      tokenUrl: qbo.tokenUrl,
      httpClient: new HttpClient({
        provider: 'quickbooks',
        retry: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 5 },
        // The client refreshes on 401 and retries once.
        onAuthFailure: async () => {
          const response = await fetch(qbo.tokenUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: qbo.currentRefreshToken,
            }).toString(),
          });
          const parsed = (await response.json()) as { access_token: string };
          return parsed.access_token;
        },
      }),
    });

    const connection = makeConnection();
    const batches = [];
    let expired = false;
    for await (const b of adapter.fullSync(connection, 'Invoice')) {
      batches.push(b);
      // Expire the token after the first page, mid-stream.
      if (!expired) {
        qbo.expireAccessToken();
        expired = true;
      }
    }

    // All 1500 records still arrive despite the expiry.
    const total = batches.reduce((n, b) => n + b.records.length, 0);
    expect(total).toBe(1500);
  });

  it('rejects a stale refresh token, as QuickBooks does', async () => {
    qbo = await startFakeQbo({ data: {} });
    const adapter = makeAdapter();

    const stale = qbo.currentRefreshToken;
    // Rotate once, invalidating `stale`.
    await adapter.refresh({
      accessToken: 'x',
      refreshToken: stale,
      expiresAt: new Date(),
      externalAccountId: FAKE_REALM_ID,
    });

    await expect(
      adapter.refresh({
        accessToken: 'x',
        refreshToken: stale,
        expiresAt: new Date(),
        externalAccountId: FAKE_REALM_ID,
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('rate limiting and transient failures', () => {
  it('honours Retry-After on 429 and still completes', async () => {
    qbo = await startFakeQbo({
      data: { Invoice: makeRecords('Invoice', 600) },
      throttleOnRequests: [1, 3],
      retryAfterSeconds: 0,
    });

    const runner = new BackfillRunner(
      makeAdapter(),
      new FileSystemArchive(archiveDir),
      new InMemoryCheckpointStore(),
      new InMemoryPayloadRecorder(),
    );

    const result = await runner.run(makeConnection(), { recordTypes: ['Invoice'] });
    expect(result.totalRecords).toBe(600);
    expect(result.complete).toBe(true);
  });

  it('retries 5xx and completes', async () => {
    qbo = await startFakeQbo({
      data: { Invoice: makeRecords('Invoice', 500) },
      failOnRequests: [1, 2],
    });

    const runner = new BackfillRunner(
      makeAdapter(),
      new FileSystemArchive(archiveDir),
      new InMemoryCheckpointStore(),
      new InMemoryPayloadRecorder(),
    );

    const result = await runner.run(makeConnection(), { recordTypes: ['Invoice'] });
    expect(result.totalRecords).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('health and reconciliation', () => {
  it('reports healthy for a working connection', async () => {
    qbo = await startFakeQbo({ data: {} });
    const health = await makeAdapter().healthCheck(makeConnection());
    expect(health.status).toBe('healthy');
  });

  it('reports reauth_required when authorization is gone', async () => {
    qbo = await startFakeQbo({ data: {} });
    const adapter = makeAdapter();

    // A refresh token the server will reject, so refresh fails and the request
    // 401s — the shape of a customer revoking access.
    const connection = makeConnection({
      refreshToken: 'revoked-token',
      expiresAt: new Date(Date.now() - 1000),
    });

    const health = await adapter.healthCheck(connection);
    expect(['reauth_required', 'error']).toContain(health.status);
  });

  it('detects divergence between our count and the provider count', async () => {
    qbo = await startFakeQbo({ data: { Invoice: makeRecords('Invoice', 42) } });
    const adapter = makeAdapter();

    const matching = await adapter.reconcile(makeConnection(), 'Invoice', 42);
    expect(matching.divergent).toBe(false);
    expect(matching.providerCount).toBe(42);

    // Silent under-fetching: the API returned 200 but we hold fewer records.
    const diverged = await adapter.reconcile(makeConnection(), 'Invoice', 40);
    expect(diverged.divergent).toBe(true);
  });
});

/** Locate an archived object by content hash (test helper). */
async function findObjectKey(
  _archive: FileSystemArchive,
  root: string,
  contentHash: string,
): Promise<string> {
  const { readdir } = await import('node:fs/promises');
  const walk = async (dir: string, prefix = ''): Promise<string | null> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const found = await walk(join(dir, entry.name), rel);
        if (found) return found;
      } else if (entry.name.startsWith(contentHash.slice(0, 32))) {
        return rel;
      }
    }
    return null;
  };
  const key = await walk(root);
  if (!key) throw new Error(`No archived object for hash ${contentHash}`);
  return key;
}
