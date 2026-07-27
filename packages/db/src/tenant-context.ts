/**
 * Tenant context — layer 2 of the isolation strategy.
 *
 * Postgres RLS (layer 1) is the backstop. This layer's job is to make the unsafe
 * thing *unwritable* rather than merely ineffective: there is no exported handle
 * that can run a tenant-scoped query without a tenant context, so a developer
 * cannot accidentally forget one. The compiler enforces it.
 *
 * The mechanism:
 *   - The raw pool is not exported.
 *   - `withTenant(ctx, fn)` opens a transaction, sets `app.current_org_id`, and
 *     hands the callback a `TenantDb` — a branded handle that repositories
 *     require. Outside that callback there is nothing to query with.
 *
 * Why a transaction rather than a session variable on the connection:
 * `set_config(..., is_local => true)` scopes the setting to the transaction, so
 * it is unwound automatically on commit or rollback. With a connection pool, a
 * session-scoped setting would leak to the next request that borrows the same
 * connection — which is a cross-tenant data leak with no bug in any query. This
 * is the single subtlest failure mode in the whole design, and it is why the
 * `true` argument below is not optional.
 */

import type { Pool, PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema/index.js';

declare const TenantDbBrand: unique symbol;

/**
 * A database handle proven to be operating inside a tenant scope.
 * Only obtainable from `withTenant`. Repositories accept nothing else.
 */
export type TenantDb = NodePgDatabase<typeof schema> & {
  readonly [TenantDbBrand]: true;
  readonly orgId: string;
};

/** Who is acting, and on which organization. */
export interface TenantContext {
  /** The single organization this unit of work may touch. */
  readonly orgId: string;
  readonly actor: Actor;
}

export type Actor =
  | { readonly type: 'user'; readonly userId: string }
  | { readonly type: 'api_key'; readonly apiKeyId: string }
  /**
   * A firm user acting on a client org. Note this still carries exactly ONE
   * orgId: firm breadth is achieved by a series of single-org scopes, never by
   * widening one. See docs/03-engineering/security.md §3.
   */
  | { readonly type: 'firm'; readonly firmId: string; readonly userId: string }
  /** Background jobs (sync, forecast, alerts). Still tenant-scoped. */
  | { readonly type: 'system'; readonly jobName: string };

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a transaction scoped to one organization.
 *
 * Everything inside is subject to RLS bound to `ctx.orgId`. The scope is released
 * when the transaction ends, whether it commits or rolls back.
 */
export async function withTenant<T>(
  pool: Pool,
  ctx: TenantContext,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  // Belt and braces: the value is parameterised below, but validating here means
  // a malformed id fails loudly at the boundary instead of silently matching
  // nothing further in.
  if (!UUID_RE.test(ctx.orgId)) {
    throw new TenantContextError(`orgId is not a valid UUID: ${JSON.stringify(ctx.orgId)}`);
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Parameterised, so a hostile orgId cannot escape into SQL. `true` =>
    // transaction-local, which is what stops the setting leaking across pooled
    // connections.
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', ctx.orgId]);

    // The brand is a compile-time marker with no runtime representation, so the
    // cast goes via `unknown`. This is the one place in the codebase permitted to
    // mint a TenantDb — which is precisely what makes the guarantee hold
    // everywhere else.
    const db = drizzle(client, { schema }) as unknown as TenantDb;
    Object.defineProperty(db, 'orgId', { value: ctx.orgId, enumerable: false });

    const result = await fn(db);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* the original error is more useful than a rollback failure */
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Escape hatch for genuinely cross-tenant work: migrations, fleet-wide scheduled
 * jobs that fan out per org, and platform administration.
 *
 * Deliberately named to be ugly and greppable. Every call site should be
 * reviewable by searching for this identifier, and the CI lint rule restricts it
 * to the directories that legitimately need it.
 *
 * It does NOT disable RLS — the policies still apply to whatever role is
 * connected. It only omits the tenant scope, so under the application role it
 * will correctly return nothing.
 */
export async function unsafeWithoutTenantScope<T>(
  pool: Pool,
  reason: string,
  fn: (db: NodePgDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  if (!reason || reason.trim().length < 10) {
    throw new TenantContextError(
      'unsafeWithoutTenantScope requires a substantive `reason` for the audit trail',
    );
  }
  const client = await pool.connect();
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    client.release();
  }
}

/**
 * Assert the connected role cannot bypass RLS.
 *
 * Verified against PostgreSQL 16.13: a superuser or a BYPASSRLS role ignores
 * every policy, FORCE notwithstanding. That makes the isolation guarantee
 * conditional on a deployment fact rather than on the schema — so we check it at
 * startup and in the tenancy suite, instead of assuming it.
 *
 * Without this check the isolation tests would pass for the wrong reason on a
 * misconfigured deployment, which is the worst possible outcome: a green suite
 * over an open door.
 */
export async function assertRoleCannotBypassRls(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT rolname, rolsuper, rolbypassrls
       FROM pg_roles
      WHERE rolname = current_user`,
  );

  const role = rows[0];
  if (!role) {
    throw new TenantContextError(`Could not resolve current_user in pg_roles`);
  }
  if (role.rolsuper || role.rolbypassrls) {
    throw new TenantContextError(
      `Refusing to start: application role "${role.rolname}" can bypass row-level security ` +
        `(rolsuper=${role.rolsuper}, rolbypassrls=${role.rolbypassrls}). ` +
        `Tenant isolation would be silently disabled. Connect as a NOSUPERUSER, ` +
        `NOBYPASSRLS role that does not own the tables.`,
    );
  }
}

/** True when the connected role also owns the tables (owners bypass RLS without FORCE). */
export async function isTableOwner(pool: Pool, table = 'connections'): Promise<boolean> {
  const { rows } = await pool.query<{ owns: boolean }>(
    `SELECT tableowner = current_user AS owns FROM pg_tables WHERE tablename = $1`,
    [table],
  );
  return rows[0]?.owns ?? false;
}
