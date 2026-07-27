import pg from 'pg';
import type { Pool as PoolType, PoolConfig } from 'pg';

const { Pool, types } = pg;

/**
 * Postgres type parsers.
 *
 * node-postgres returns NUMERIC as a string by default, which is correct and must
 * stay that way — parsing it to a float would reintroduce exactly the precision
 * loss the Money type exists to prevent. This is asserted in a test, because a
 * future dependency bump or a well-meaning "fix" could change it silently, and
 * the resulting bug would be invisible until someone's books didn't balance.
 */
const PG_NUMERIC_OID = 1700;
const PG_INT8_OID = 20;

types.setTypeParser(PG_NUMERIC_OID, (value: string) => value);
// BIGINT likewise: JS numbers cannot represent the full int8 range.
types.setTypeParser(PG_INT8_OID, (value: string) => value);

export interface DbConfig {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly applicationName?: string;
  readonly ssl?: PoolConfig['ssl'];
}

export function createPool(config: DbConfig): PoolType {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 10,
    application_name: config.applicationName ?? 'ledgeriq',
    // Fail fast rather than hanging a request behind an exhausted pool.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ...(config.ssl !== undefined ? { ssl: config.ssl } : {}),
  });
}

export function connectionStringFromEnv(varName = 'DATABASE_URL'): string {
  const value = process.env[varName];
  if (!value) {
    throw new Error(`${varName} is not set`);
  }
  return value;
}

export type { PoolType as Pool };
