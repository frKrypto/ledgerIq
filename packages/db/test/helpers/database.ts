import pg from 'pg';
import type { Pool } from 'pg';
import { migrate } from '../../src/migrate.js';
import { createPool } from '../../src/client.js';

/**
 * Test database harness.
 *
 * Two roles matter here and conflating them defeats the whole exercise:
 *
 *   adminPool — owns the tables, runs migrations. Bypasses RLS (owner + often
 *               superuser locally), so it is used ONLY for fixtures and teardown.
 *   appPool   — NOSUPERUSER, NOBYPASSRLS, not the owner. This is how the running
 *               application connects, and the only role isolation claims are
 *               made about.
 *
 * A suite that tests isolation using the admin role proves nothing, which is the
 * subtle way these test suites end up green over an open door.
 */

export interface TestDatabase {
  readonly adminPool: Pool;
  readonly appPool: Pool;
  readonly close: () => Promise<void>;
}

const APP_ROLE = 'ledgeriq_app';
const APP_PASSWORD = 'ledgeriq_test';

function appConnectionString(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  return url.toString();
}

export async function setupTestDatabase(): Promise<TestDatabase> {
  const adminUrl =
    process.env['TEST_DATABASE_URL'] ??
    process.env['ADMIN_DATABASE_URL'] ??
    'postgres://postgres@localhost:5432/ledgeriq_test';

  const adminPool = createPool({ connectionString: adminUrl, applicationName: 'ledgeriq-test-admin' });

  // Fresh schema every run: a leftover object from a previous shape produces
  // failures that look like logic bugs.
  await adminPool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await adminPool.query('CREATE SCHEMA public');

  await adminPool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
          PASSWORD ${pg.escapeLiteral(APP_PASSWORD)};
      ELSE
        ALTER ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
          PASSWORD ${pg.escapeLiteral(APP_PASSWORD)};
      END IF;
    END $$;
  `);

  await migrate(adminPool);

  const appPool = createPool({
    connectionString: appConnectionString(adminUrl),
    applicationName: 'ledgeriq-test-app',
  });

  return {
    adminPool,
    appPool,
    close: async () => {
      await appPool.end();
      await adminPool.end();
    },
  };
}

/** Seed two organizations with data on each. Returns their ids. */
export async function seedTwoTenants(adminPool: Pool): Promise<{
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
  connectionA: string;
  connectionB: string;
}> {
  const { rows: orgRows } = await adminPool.query<{ id: string; name: string }>(
    `INSERT INTO organizations (name, business_model)
     VALUES ('Tenant A', 'services'), ('Tenant B', 'ecommerce')
     RETURNING id, name`,
  );
  const orgA = orgRows.find((r) => r.name === 'Tenant A')?.id;
  const orgB = orgRows.find((r) => r.name === 'Tenant B')?.id;
  if (!orgA || !orgB) throw new Error('Failed to seed organizations');

  const { rows: userRows } = await adminPool.query<{ id: string; email: string }>(
    `INSERT INTO users (external_auth_id, email, full_name)
     VALUES ('auth_a', 'a@example.com', 'User A'), ('auth_b', 'b@example.com', 'User B')
     RETURNING id, email`,
  );
  const userA = userRows.find((r) => r.email === 'a@example.com')?.id;
  const userB = userRows.find((r) => r.email === 'b@example.com')?.id;
  if (!userA || !userB) throw new Error('Failed to seed users');

  await adminPool.query(
    `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')`,
    [orgA, userA, orgB, userB],
  );

  const { rows: conns } = await adminPool.query<{ id: string; org_id: string }>(
    `INSERT INTO connections (org_id, source, source_kind, display_name)
     VALUES ($1, 'quickbooks', 'accounting', 'Tenant A Books'),
            ($2, 'quickbooks', 'accounting', 'Tenant B Books')
     RETURNING id, org_id`,
    [orgA, orgB],
  );

  const connectionA = conns.find((c) => c.org_id === orgA)?.id;
  const connectionB = conns.find((c) => c.org_id === orgB)?.id;
  if (!connectionA || !connectionB) throw new Error('Failed to seed connections');

  return { orgA, orgB, userA, userB, connectionA, connectionB };
}
