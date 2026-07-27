import { createPool, connectionStringFromEnv, assertRoleCannotBypassRls } from '@ledgeriq/db';
import type { Pool } from 'pg';

/**
 * Startup checks.
 *
 * The role check is not a nicety. RLS is bypassed entirely by superusers and
 * BYPASSRLS roles, FORCE notwithstanding, so tenant isolation is conditional on
 * a deployment fact that Terraform sets and a well-meaning operator can undo.
 *
 * Refusing to boot is the correct response: an application serving traffic with
 * silently-disabled isolation is worse than an application that is down.
 */
export async function bootstrap(): Promise<Pool> {
  const pool = createPool({
    connectionString: connectionStringFromEnv(),
    applicationName: 'ledgeriq-api',
    maxConnections: Number(process.env['DB_POOL_MAX'] ?? 10),
  });

  await assertRoleCannotBypassRls(pool);

  return pool;
}
