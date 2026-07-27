/**
 * Create the application role for local development and CI.
 *
 * In real environments Terraform owns this (infra/modules/database). The role
 * attributes are the point: NOSUPERUSER and NOBYPASSRLS are what make the RLS
 * policies actually apply. See docs/03-engineering/security.md §3.
 */
import pg from 'pg';

const admin = process.env['ADMIN_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!admin) throw new Error('ADMIN_DATABASE_URL or DATABASE_URL must be set');

const password = process.env['APP_DB_PASSWORD'] ?? 'ledgeriq_dev';

const pool = new pg.Pool({ connectionString: admin });
try {
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgeriq_app') THEN
        CREATE ROLE ledgeriq_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
          PASSWORD ${pg.escapeLiteral(password)};
      ELSE
        ALTER ROLE ledgeriq_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
          PASSWORD ${pg.escapeLiteral(password)};
      END IF;
    END $$;
  `);
  console.log('role ledgeriq_app ready (NOSUPERUSER, NOBYPASSRLS)');
} finally {
  await pool.end();
}
