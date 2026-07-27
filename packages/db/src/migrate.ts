import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

/**
 * Minimal forward-only migration runner.
 *
 * Deliberately not drizzle-kit: RLS policies, partial indexes, grants, and
 * expand/contract sequencing have no ORM representation, and hand-written SQL
 * keeps them reviewable in a diff. The migration policy is in
 * docs/03-engineering/database-schema.md §6 — expand/contract only, never a
 * destructive change in the same deploy as the code that stops using a column.
 *
 * Applied migrations are checksummed. Editing a migration that has already run is
 * an error rather than a silent no-op, because in a team that divergence produces
 * environments whose schemas differ in ways nobody can reproduce.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationResult {
  readonly applied: string[];
  readonly skipped: string[];
}

const CREATE_BOOKKEEPING = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name        TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms INTEGER NOT NULL
  )`;

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

export async function migrate(
  pool: Pool,
  opts: { dir?: string; log?: (msg: string) => void } = {},
): Promise<MigrationResult> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const log = opts.log ?? (() => {});

  await pool.query(CREATE_BOOKKEEPING);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  const already = new Map(rows.map((r) => [r.name, r.checksum]));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const body = await readFile(join(dir, file), 'utf8');
    const checksum = sha256(body);
    const previous = already.get(file);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${file} has changed since it was applied ` +
            `(recorded ${previous.slice(0, 12)}, now ${checksum.slice(0, 12)}). ` +
            `Migrations are immutable once applied — add a new one instead.`,
        );
      }
      skipped.push(file);
      continue;
    }

    const started = Date.now();
    const client = await pool.connect();
    try {
      // Each migration is one transaction: a failure leaves no partial schema.
      await client.query('BEGIN');
      await client.query(body);
      await client.query(
        'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
        [file, checksum, Date.now() - started],
      );
      await client.query('COMMIT');
      log(`applied ${file} (${Date.now() - started}ms)`);
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}
