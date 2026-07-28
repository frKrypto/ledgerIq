import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { setupTestDatabase, seedTwoTenants, type TestDatabase } from './helpers/database.js';
import {
  withTenant,
  assertRoleCannotBypassRls,
  unsafeWithoutTenantScope,
  TenantContextError,
} from '../src/tenant-context.js';
import { TENANT_SCOPED_TABLES, GLOBAL_TABLES } from '../src/schema/tables.js';
import { connections } from '../src/schema/index.js';
import { eq, sql } from 'drizzle-orm';

/**
 * ADVERSARIAL TENANCY SUITE
 *
 * This suite blocks CI and has no override path. It guards the one failure that
 * ends the company: one customer seeing another's financials.
 *
 * It is deliberately written from the attacker's side — every case tries to
 * *break* isolation rather than confirm it works on the happy path.
 *
 * Read §0 first: without the role preconditions, every case below would pass for
 * the wrong reason on a misconfigured deployment.
 */

let db: TestDatabase;
let tenants: Awaited<ReturnType<typeof seedTwoTenants>>;
let appPool: Pool;

beforeAll(async () => {
  db = await setupTestDatabase();
  tenants = await seedTwoTenants(db.adminPool);
  appPool = db.appPool;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§0 preconditions — the checks that make every other case meaningful', () => {
  it('the application role cannot bypass RLS', async () => {
    const { rows } = await appPool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);

    expect(rows[0]?.rolname).toBe('ledgeriq_app');
    // Verified against PG 16.13: either of these true silently disables every
    // policy in 0002_rls.sql, FORCE notwithstanding.
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('the application role does not own the tables', async () => {
    const { rows } = await appPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`,
    );
    expect(rows).toEqual([]);
  });

  it('assertRoleCannotBypassRls passes for the app role and throws for the admin role', async () => {
    await expect(assertRoleCannotBypassRls(appPool)).resolves.toBeUndefined();
    await expect(assertRoleCannotBypassRls(db.adminPool)).rejects.toThrow(TenantContextError);
  });

  it('every table is classified as either tenant-scoped or explicitly global', async () => {
    const { rows } = await db.adminPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const known = new Set<string>([...TENANT_SCOPED_TABLES, ...Object.keys(GLOBAL_TABLES)]);
    const unclassified = rows.map((r) => r.tablename).filter((t) => !known.has(t));

    // A new table added without a decision about tenancy fails here rather than
    // shipping unprotected.
    expect(unclassified).toEqual([]);
  });

  it('every tenant-scoped table has RLS enabled AND forced', async () => {
    const { rows } = await db.adminPool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE relname = ANY($1) AND relkind = 'r'`,
      [[...TENANT_SCOPED_TABLES]],
    );

    expect(rows).toHaveLength(TENANT_SCOPED_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} has RLS enabled`).toBe(true);
      // FORCE is the part people omit; without it the owner bypasses the policy.
      expect(row.relforcerowsecurity, `${row.relname} has RLS forced`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§1 read isolation', () => {
  it('an unscoped SELECT with no WHERE clause returns only the scoped tenant', async () => {
    const rows = await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      // Deliberately no filter. RLS is what makes this safe.
      async (tx) => tx.select().from(connections),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.orgId).toBe(tenants.orgA);
    expect(rows[0]?.displayName).toBe('Tenant A Books');
  });

  it('explicitly targeting another tenant by org_id returns nothing', async () => {
    const rows = await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => tx.select().from(connections).where(eq(connections.orgId, tenants.orgB)),
    );
    expect(rows).toEqual([]);
  });

  it('fetching another tenant\'s row by its primary key returns nothing', async () => {
    // The most realistic attack: an id leaks or is guessed, and is passed to an
    // endpoint that looks it up directly.
    const rows = await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => tx.select().from(connections).where(eq(connections.id, tenants.connectionB)),
    );
    expect(rows).toEqual([]);
  });

  it('aggregates cannot count another tenant\'s rows', async () => {
    // COUNT leaking across tenants is an information disclosure even when the
    // rows themselves stay hidden.
    const total = await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => {
        const [row] = await tx
          .select({ n: sql<string>`count(*)` })
          .from(connections);
        return Number(row?.n ?? 0);
      },
    );
    expect(total).toBe(1);
  });

  it('a raw SQL escape hatch is still constrained by RLS', async () => {
    // Repositories are typed, but someone will eventually reach for raw SQL.
    // The database must still hold the line.
    const rows = await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => tx.execute(sql`SELECT id, org_id FROM connections`),
    );
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { org_id: string }).org_id).toBe(tenants.orgA);
  });

  it('isolation holds across all tenant-scoped tables', async () => {
    for (const table of TENANT_SCOPED_TABLES) {
      const column = table === 'organizations' ? 'id' : 'org_id';
      const { rows } = await (async () => {
        const client = await appPool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT set_config($1, $2, true)', [
            'app.current_org_id',
            tenants.orgA,
          ]);
          const res = await client.query(
            `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`,
            [tenants.orgB],
          );
          await client.query('COMMIT');
          return res;
        } finally {
          client.release();
        }
      })();

      expect(rows[0]?.n, `${table} leaked rows belonging to tenant B`).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§2 write isolation', () => {
  it('cannot INSERT a row attributed to another tenant', async () => {
    // The write-side leak a USING-only policy would allow. WITH CHECK closes it.
    await expect(
      withTenant(
        appPool,
        { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
        async (tx) =>
          tx.insert(connections).values({
            orgId: tenants.orgB, // hostile
            source: 'stripe',
            sourceKind: 'payments',
            displayName: 'injected',
          }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot UPDATE another tenant\'s row', async () => {
    const affected = await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) =>
        tx
          .update(connections)
          .set({ displayName: 'hijacked' })
          .where(eq(connections.id, tenants.connectionB))
          .returning(),
    );
    expect(affected).toEqual([]);

    // Confirm from the admin side that the row is genuinely untouched.
    const { rows } = await db.adminPool.query<{ display_name: string }>(
      'SELECT display_name FROM connections WHERE id = $1',
      [tenants.connectionB],
    );
    expect(rows[0]?.display_name).toBe('Tenant B Books');
  });

  it('cannot re-attribute an own row to another tenant', async () => {
    await expect(
      withTenant(
        appPool,
        { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
        async (tx) =>
          tx
            .update(connections)
            .set({ orgId: tenants.orgB })
            .where(eq(connections.id, tenants.connectionA)),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('the app role cannot DELETE financial records at all', async () => {
    // Financial rows are voided, never removed. Withheld at the grant level so
    // it is a database guarantee rather than a convention.
    await expect(
      withTenant(
        appPool,
        { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
        async (tx) => tx.execute(sql`DELETE FROM connections WHERE id = ${tenants.connectionA}`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('governance logs are append-only for the app role', async () => {
    await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) =>
        tx.execute(
          sql`INSERT INTO audit_log (org_id, action, resource_type)
              VALUES (${tenants.orgA}, 'test.write', 'connection')`,
        ),
    );

    await expect(
      withTenant(
        appPool,
        { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
        async (tx) => tx.execute(sql`UPDATE audit_log SET action = 'tampered'`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§3 fail-closed behaviour', () => {
  it('a query with NO tenant context returns zero rows, not every row', async () => {
    // Simulates the bug where someone forgets to establish scope. The safe
    // failure is emptiness; the catastrophic one is a full table scan.
    const { rows } = await appPool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM connections',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('an empty-string tenant context returns zero rows rather than erroring open', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', '']);
      const { rows } = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM connections',
      );
      expect(rows[0]?.n).toBe(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('rejects a malformed orgId at the boundary', async () => {
    await expect(
      withTenant(
        appPool,
        { orgId: "' OR '1'='1", actor: { type: 'system', jobName: 'test' } },
        async (tx) => tx.select().from(connections),
      ),
    ).rejects.toThrow(TenantContextError);
  });

  it('unsafeWithoutTenantScope still returns nothing under the app role', async () => {
    // The escape hatch omits the scope; it does not disable RLS. Under the
    // application role that means it correctly sees nothing.
    const rows = await unsafeWithoutTenantScope(
      appPool,
      'tenancy suite: verifying the escape hatch is not a bypass',
      async (d) => d.select().from(connections),
    );
    expect(rows).toEqual([]);
  });

  it('unsafeWithoutTenantScope demands a substantive reason', async () => {
    await expect(
      unsafeWithoutTenantScope(appPool, 'x', async () => 1),
    ).rejects.toThrow(TenantContextError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§4 connection pooling — the subtlest leak', () => {
  it('tenant scope does not survive onto the next user of a pooled connection', async () => {
    // If the scope were set with session lifetime instead of transaction
    // lifetime, the next request to borrow this connection would inherit tenant
    // A's scope. That is a cross-tenant leak with no bug in any query, and it is
    // why set_config's is_local argument is true.
    await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
      async (tx) => tx.select().from(connections),
    );

    const { rows } = await appPool.query<{ setting: string | null }>(
      `SELECT current_setting('app.current_org_id', true) AS setting`,
    );
    expect(rows[0]?.setting ?? '').toBe('');
  });

  it('scope is released even when the transaction throws', async () => {
    await expect(
      withTenant(
        appPool,
        { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    const { rows } = await appPool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM connections',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('concurrent tenant scopes do not bleed into one another', async () => {
    // Interleaved work on a shared pool is the realistic production condition.
    const [a, b] = await Promise.all([
      withTenant(
        appPool,
        { orgId: tenants.orgA, actor: { type: 'user', userId: tenants.userA } },
        async (tx) => {
          await new Promise((r) => setTimeout(r, 25));
          return tx.select().from(connections);
        },
      ),
      withTenant(
        appPool,
        { orgId: tenants.orgB, actor: { type: 'user', userId: tenants.userB } },
        async (tx) => tx.select().from(connections),
      ),
    ]);

    expect(a).toHaveLength(1);
    expect(a[0]?.orgId).toBe(tenants.orgA);
    expect(b).toHaveLength(1);
    expect(b[0]?.orgId).toBe(tenants.orgB);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§5 firm access does not widen tenant scope', () => {
  it('a firm advisor sees exactly one client org per scope', async () => {
    const { rows } = await db.adminPool.query<{ id: string }>(
      `INSERT INTO firms (name) VALUES ('Test Firm') RETURNING id`,
    );
    const firmId = rows[0]?.id;
    if (!firmId) throw new Error('firm seed failed');

    await db.adminPool.query(
      `INSERT INTO firm_clients (firm_id, org_id) VALUES ($1, $2), ($1, $3)`,
      [firmId, tenants.orgA, tenants.orgB],
    );

    // The firm is granted both orgs, but a scope is still one org at a time.
    const seenInA = await withTenant(
      appPool,
      { orgId: tenants.orgA, actor: { type: 'firm', firmId, userId: tenants.userA } },
      async (tx) => tx.select().from(connections),
    );

    expect(seenInA).toHaveLength(1);
    expect(seenInA[0]?.orgId).toBe(tenants.orgA);
  });
});
