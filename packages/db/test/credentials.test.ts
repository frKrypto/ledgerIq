import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalKms } from '@ledgeriq/crypto';
import { setupTestDatabase, seedTwoTenants, type TestDatabase } from './helpers/database.js';
import { withTenant } from '../src/tenant-context.js';
import {
  readCredentials,
  storeCredentials,
  rotateCredentials,
} from '../src/repositories/credentials.js';

/**
 * Credential vault, tested end-to-end against a real database.
 *
 * The unit tests in @ledgeriq/crypto prove the primitives. These prove the
 * property that actually matters operationally: what lands in the database is
 * useless to someone holding only the database.
 */

let db: TestDatabase;
let tenants: Awaited<ReturnType<typeof seedTwoTenants>>;
const kms = new LocalKms('test-root-key');

const CREDS = {
  accessToken: 'qbo_access_ABC123',
  refreshToken: 'qbo_refresh_XYZ789',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  externalAccountId: '4620816365320125',
};

beforeAll(async () => {
  db = await setupTestDatabase();
  tenants = await seedTwoTenants(db.adminPool);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('credential vault', () => {
  it('round-trips credentials through the database', async () => {
    await withTenant(
      db.appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => {
        await storeCredentials(tx, kms, tenants.connectionA, CREDS);
      },
    );

    const read = await withTenant(
      db.appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => readCredentials(tx, kms, tenants.connectionA),
    );

    expect(read).toEqual(CREDS);
  });

  it('stores no plaintext token anywhere in the database', async () => {
    // The concrete threat: an attacker exfiltrates a dump. Scan the raw column
    // for the secret rather than trusting that encryption was applied.
    const { rows } = await db.adminPool.query<{ credentials_encrypted: string | null }>(
      'SELECT credentials_encrypted FROM connections WHERE id = $1',
      [tenants.connectionA],
    );

    const stored = rows[0]?.credentials_encrypted ?? '';
    expect(stored.length).toBeGreaterThan(0);
    expect(stored).not.toContain(CREDS.accessToken);
    expect(stored).not.toContain(CREDS.refreshToken);
    expect(Buffer.from(stored, 'base64').toString('utf8')).not.toContain('qbo_');
  });

  it('stores the data key wrapped, never in plaintext', async () => {
    const { rows } = await db.adminPool.query<{ wrapped_key: string; kms_key_id: string }>(
      'SELECT wrapped_key, kms_key_id FROM tenant_data_keys WHERE org_id = $1',
      [tenants.orgA],
    );

    expect(rows).toHaveLength(1);
    // 32-byte AES key + 12-byte IV + 16-byte tag = 60 bytes wrapped; a plaintext
    // key would be exactly 32.
    expect(Buffer.from(rows[0]?.wrapped_key ?? '', 'base64').length).toBeGreaterThan(32);
  });

  it('a dump plus the wrong KMS root key yields nothing', async () => {
    const attackerKms = new LocalKms('not-the-real-root-key');

    await expect(
      withTenant(
        db.appPool,
        { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
        async (tx) => readCredentials(tx, attackerKms, tenants.connectionA),
      ),
    ).rejects.toThrow();
  });

  it('each tenant gets its own data key', async () => {
    await withTenant(
      db.appPool,
      { orgId: tenants.orgB, actor: { type: 'user', userId: tenants.userB } },
      async (tx) => {
        await storeCredentials(tx, kms, tenants.connectionB, {
          ...CREDS,
          accessToken: 'tenant_b_token',
        });
      },
    );

    const { rows } = await db.adminPool.query<{ org_id: string; wrapped_key: string }>(
      'SELECT org_id, wrapped_key FROM tenant_data_keys ORDER BY org_id',
    );

    expect(rows).toHaveLength(2);
    // Distinct DEKs: compromising one tenant's key does not extend to the other.
    expect(rows[0]?.wrapped_key).not.toBe(rows[1]?.wrapped_key);
  });

  it("one tenant cannot read another tenant's credentials even by id", async () => {
    // RLS already hides the row; this asserts the combined behaviour rather than
    // assuming the two layers compose.
    const result = await withTenant(
      db.appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => readCredentials(tx, kms, tenants.connectionB),
    );
    expect(result).toBeNull();
  });

  it('rotation replaces the stored credential and clears the failure state', async () => {
    const rotated = { ...CREDS, accessToken: 'rotated_access', refreshToken: 'rotated_refresh' };

    await withTenant(
      db.appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => {
        await rotateCredentials(tx, kms, tenants.connectionA, rotated);
      },
    );

    const read = await withTenant(
      db.appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => readCredentials(tx, kms, tenants.connectionA),
    );

    expect(read?.accessToken).toBe('rotated_access');

    const { rows } = await db.adminPool.query<{ status: string; consecutive_failures: number }>(
      'SELECT status, consecutive_failures FROM connections WHERE id = $1',
      [tenants.connectionA],
    );
    expect(rows[0]?.status).toBe('active');
    expect(rows[0]?.consecutive_failures).toBe(0);
  });
});
