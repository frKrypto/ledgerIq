import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { createPool, connectionStringFromEnv, assertRoleCannotBypassRls } from '@ledgeriq/db';
import { LocalKms, AwsKms, type KmsProvider } from '@ledgeriq/crypto';
import { FileSystemArchive, S3Archive, type RawPayloadArchive } from '@ledgeriq/connectors';

/**
 * Shared CLI wiring.
 *
 * The CLI exists to drive the real ingestion pipeline against a real QuickBooks
 * sandbox before any UI exists. That ordering is deliberate: the biggest
 * remaining unknown is the shape of real books — 400-account charts of accounts,
 * inconsistent naming, entities our fake server never imagined — and finding
 * that in month one is worth far more than finding it after the normalization
 * layer is built on top of assumptions.
 */

export interface CliConfig {
  /** Tenant-scoped work. RLS-enforced; everything real goes through here. */
  readonly pool: Pool;
  /**
   * Bootstrap lookups that must happen BEFORE a tenant scope exists.
   *
   * There is a genuine chicken-and-egg here: resolving "which org owns this
   * connection id" cannot be done under RLS, because RLS needs the org to decide
   * what is visible. The first smoke test of this CLI failed on exactly that —
   * the lookup ran on the app pool with no scope and correctly returned nothing.
   *
   * Production does not have this problem: the API learns the org from the
   * authenticated session's memberships, then opens a scope. Only an operator
   * tool that takes a bare connection id needs this, so the escape is confined
   * here, narrow, and used for nothing but resolving an id to an org.
   */
  readonly adminPool: Pool;
  readonly kms: KmsProvider;
  readonly archive: RawPayloadArchive;
  readonly quickbooks: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly redirectUri: string;
    readonly sandbox: boolean;
    /**
     * Endpoint overrides. Present so the full CLI path — connect, sync, status,
     * inspect — can be exercised against the fake QuickBooks server before real
     * Intuit credentials exist. Unset in any real use.
     */
    readonly apiBase?: string;
    readonly tokenUrl?: string;
  };
}

/**
 * A KMS that refuses rather than pretends.
 *
 * Returned when a command declared it does not need keys. If one ever does reach
 * for a key, it fails loudly here instead of quietly deriving something from a
 * default — a wrong key that "works" is how credentials become unreadable later.
 */
function withheldKms(): KmsProvider {
  const refuse = (): never => {
    throw new ConfigError(
      'This command was loaded without KMS access but tried to use a key.\n' +
        'Pass requireKms to loadConfig() in the command that needs it.',
    );
  };
  return {
    get keyId(): string { return refuse(); },
    wrap: () => Promise.reject(new ConfigError('KMS not loaded for this command')),
    unwrap: () => Promise.reject(new ConfigError('KMS not loaded for this command')),
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(
      `${name} is not set.\n\n${hint}\n\nSee docs/03-engineering/local-quickbooks.md`,
    );
  }
  return value;
}

export const DEFAULT_ARCHIVE_DIR = join(homedir(), '.ledgeriq', 'archive');

export async function loadConfig(
  opts: { requireQuickBooks?: boolean; requireKms?: boolean } = {},
): Promise<CliConfig> {
  const pool = createPool({
    connectionString: connectionStringFromEnv(),
    applicationName: 'ledgeriq-cli',
    maxConnections: 5,
  });

  // The CLI writes real tenant data, so it must connect under the same
  // constraints as the application. Running it as the owner role would let it
  // write rows that the application itself could never read back.
  await assertRoleCannotBypassRls(pool);

  // Commands that never touch stored credentials do not need a key.
  //
  // This is not just convenience. The forecast job is meant to run unattended
  // every night, and demanding a KMS passphrase to compute arithmetic over rows
  // already in the database is the kind of friction that ends with the job not
  // being scheduled at all — which, for the accuracy series, is unrecoverable.
  // Withheld rather than faked: any command that does reach for a key without
  // asking for one gets a clear error instead of a silently wrong cipher.
  const kmsKeyId = process.env['KMS_KEY_ID'];
  const kms: KmsProvider =
    opts.requireKms === false
      ? withheldKms()
      : kmsKeyId
        ? new AwsKms(kmsKeyId)
        : new LocalKms(
            required(
              'LOCAL_KMS_ROOT_KEY',
              'Local development uses an in-process KMS. Set LOCAL_KMS_ROOT_KEY to any\n' +
                'passphrase — it derives the root key that wraps each tenant data key.\n' +
                'Changing it makes previously stored credentials unreadable.',
            ),
          );

  const bucket = process.env['ARCHIVE_S3_BUCKET'];
  const archive: RawPayloadArchive = bucket
    ? new S3Archive(bucket)
    : new FileSystemArchive(process.env['ARCHIVE_DIR'] ?? DEFAULT_ARCHIVE_DIR);

  const quickbooks = opts.requireQuickBooks
    ? {
        clientId: required(
          'QBO_CLIENT_ID',
          'Create a QuickBooks app at https://developer.intuit.com, then copy the\n' +
            'Development client ID and secret into .env.',
        ),
        clientSecret: required('QBO_CLIENT_SECRET', 'From the same Intuit app keys page.'),
        redirectUri: process.env['QBO_REDIRECT_URI'] ?? 'http://localhost:4000/callback',
        sandbox: process.env['QBO_SANDBOX'] !== 'false',
        ...(process.env['QBO_API_BASE'] ? { apiBase: process.env['QBO_API_BASE'] } : {}),
        ...(process.env['QBO_TOKEN_URL'] ? { tokenUrl: process.env['QBO_TOKEN_URL'] } : {}),
      }
    : { clientId: '', clientSecret: '', redirectUri: '', sandbox: true };

  // Falls back to the app connection string when no admin URL is configured, so
  // a misconfigured environment fails closed rather than silently escalating.
  const adminPool = createPool({
    connectionString: process.env['ADMIN_DATABASE_URL'] ?? connectionStringFromEnv(),
    applicationName: 'ledgeriq-cli-admin',
    maxConnections: 2,
  });

  return { pool, adminPool, kms, archive, quickbooks };
}

/** Small formatting helpers — the CLI is an operator tool, so legibility matters. */
export const fmt = {
  bold: (s: string) => `[1m${s}[0m`,
  dim: (s: string) => `[2m${s}[0m`,
  green: (s: string) => `[32m${s}[0m`,
  yellow: (s: string) => `[33m${s}[0m`,
  red: (s: string) => `[31m${s}[0m`,
  cyan: (s: string) => `[36m${s}[0m`,
  count: (n: number) => n.toLocaleString('en-US'),
};

export function table(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return fmt.dim('  (none)');
  const cols = Object.keys(rows[0] as Record<string, unknown>);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').replace(/\[\d+m/g, '').length)),
  );

  const line = (cells: string[]): string =>
    '  ' +
    cells
      .map((cell, i) => {
        const visible = cell.replace(/\[\d+m/g, '').length;
        return cell + ' '.repeat(Math.max(0, (widths[i] ?? 0) - visible));
      })
      .join('  ');

  return [
    line(cols.map((c) => fmt.dim(c))),
    ...rows.map((r) => line(cols.map((c) => String(r[c] ?? '')))),
  ].join('\n');
}
