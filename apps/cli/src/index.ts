#!/usr/bin/env node
/**
 * LedgerIQ operator CLI.
 *
 * Exists so the real ingestion pipeline can be driven against a real QuickBooks
 * sandbox before any UI exists. Sprint 3 designs normalization against the shape
 * of real books, and this is how that shape gets examined.
 */
import { ConfigError, fmt } from './context.js';
import { connect } from './commands/connect.js';
import { sync } from './commands/sync.js';
import { status, inspect } from './commands/status.js';

const USAGE = `
${fmt.bold('ledgeriq')} — operator CLI

  ${fmt.cyan('connect')} [--org <name>] [--port <n>]
      Run the QuickBooks OAuth flow and store credentials encrypted.

  ${fmt.cyan('sync')} --connection <id> [--types Invoice,Customer] [--months 24]
      Backfill from QuickBooks. Ctrl-C is safe — re-run to resume.

  ${fmt.cyan('status')} [--org <name>]
      Connections, data freshness, and per-record-type sync progress.

  ${fmt.cyan('inspect')} --connection <id> --type Invoice [--limit 3] [--fields]
      Dump archived records. --fields shows field coverage across real data,
      which is the input to normalization design.

${fmt.dim('Setup: docs/03-engineering/local-quickbooks.md')}
`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);

  switch (command) {
    case 'connect': {
      const org = flag(argv, 'org');
      const port = flag(argv, 'port');
      await connect({
        ...(org !== undefined ? { orgName: org } : {}),
        ...(port !== undefined ? { port: Number(port) } : {}),
      });
      break;
    }
    case 'sync': {
      const connection = flag(argv, 'connection');
      if (!connection) throw new ConfigError('sync requires --connection <id>');
      const types = flag(argv, 'types');
      const months = flag(argv, 'months');
      await sync({
        connectionId: connection,
        ...(types !== undefined ? { recordTypes: types.split(',') } : {}),
        ...(months !== undefined ? { months: Number(months) } : {}),
      });
      break;
    }
    case 'status': {
      const org = flag(argv, 'org');
      await status(org !== undefined ? { orgName: org } : {});
      break;
    }
    case 'inspect': {
      const connection = flag(argv, 'connection');
      const type = flag(argv, 'type');
      if (!connection || !type) {
        throw new ConfigError('inspect requires --connection <id> --type <RecordType>');
      }
      const limit = flag(argv, 'limit');
      await inspect({
        connectionId: connection,
        recordType: type,
        ...(limit !== undefined ? { limit: Number(limit) } : {}),
        fields: argv.includes('--fields'),
      });
      break;
    }
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(`\n${fmt.red('Configuration error')}\n\n${err.message}\n`);
  } else {
    console.error(`\n${fmt.red('Error')}  ${(err as Error).message}\n`);
    if (process.env['DEBUG']) console.error(err);
  }
  process.exitCode = 1;
});
