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
import { demo } from './commands/demo.js';
import { reconcile } from './commands/reconcile.js';
import { forecastRecord, forecastScore, forecastAccuracy, forecastBackfill } from './commands/forecast.js';

const USAGE = `
${fmt.bold('ledgeriq')} — operator CLI

  ${fmt.cyan('demo')} [--org <name>] [--months 24]
      Build a complete demo business and run it through the real pipeline.
      No Intuit credentials needed. Then: npm run web

  ${fmt.cyan('connect')} [--org <name>] [--port <n>]
      Run the QuickBooks OAuth flow and store credentials encrypted.

  ${fmt.cyan('sync')} --connection <id> [--types Invoice,Customer] [--months 24]
      Backfill from QuickBooks. Ctrl-C is safe — re-run to resume.

  ${fmt.cyan('status')} [--org <name>]
      Connections, data freshness, and per-record-type sync progress.

  ${fmt.cyan('inspect')} --connection <id> --type Invoice [--limit 3] [--fields]
      Dump archived records. --fields shows field coverage across real data,
      which is the input to normalization design.

  ${fmt.cyan('forecast')} <record|score|accuracy> [--org <name>]
      record    generate and store today's forecast (idempotent per day)
      backfill  re-run the engine over past dates for a baseline today
                  [--days 365] [--every 7]
      score     score forecasts whose horizons have come due
      accuracy  median error, band coverage, and bias per horizon

      This is the nightly job. Forecast history cannot be rebuilt after the
      fact, so run it even before there is a scheduler.

  ${fmt.cyan('reconcile')} --connection <id> [--start YYYY-MM-DD] [--end YYYY-MM-DD]
      Compare our canonical model against QuickBooks' own P&L, per account.
      Exits non-zero on any divergence. This is the Phase 1 gate.

${fmt.dim('Setup: docs/03-engineering/local-quickbooks.md')}
`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);

  switch (command) {
    case 'demo': {
      const org = flag(argv, 'org');
      const months = flag(argv, 'months');
      await demo({
        ...(org !== undefined ? { orgName: org } : {}),
        ...(months !== undefined ? { months: Number(months) } : {}),
      });
      break;
    }
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
    case 'forecast': {
      const [sub] = argv;
      const org = flag(argv, 'org');
      const opts = org !== undefined ? { orgName: org } : {};
      if (sub === 'record') await forecastRecord(opts);
      else if (sub === 'backfill') {
        const days = flag(argv, 'days');
        const every = flag(argv, 'every');
        await forecastBackfill({
          ...opts,
          ...(days !== undefined ? { days: Number(days) } : {}),
          ...(every !== undefined ? { every: Number(every) } : {}),
        });
      }
      else if (sub === 'score') await forecastScore(opts);
      else if (sub === 'accuracy') await forecastAccuracy(opts);
      else throw new ConfigError(
        'forecast requires a subcommand: record, backfill, score, or accuracy',
      );
      break;
    }
    case 'reconcile': {
      const connection = flag(argv, 'connection');
      if (!connection) throw new ConfigError('reconcile requires --connection <id>');
      const start = flag(argv, 'start');
      const end = flag(argv, 'end');
      await reconcile({
        connectionId: connection,
        ...(start !== undefined ? { start } : {}),
        ...(end !== undefined ? { end } : {}),
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
