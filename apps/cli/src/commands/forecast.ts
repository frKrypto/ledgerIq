import { buildCashForecast } from '@ledgeriq/metrics';
import { forecastsRepo, type TenantContext } from '@ledgeriq/db';
import { loadConfig, fmt, table } from '../context.js';

/**
 * `ledgeriq forecast` — record today's forecast, score the ones that have come
 * due, and read the accuracy series back.
 *
 * This is the job that would run nightly in production. It exists as a command
 * first because the flywheel has to start turning before there is a scheduler to
 * turn it: forecast history cannot be reconstructed retroactively, so a manual
 * run today is worth more than an automated run next month.
 */

async function forEachOrg(
  orgName: string | undefined,
  fn: (org: { id: string; name: string }, ctx: TenantContext, config: Awaited<ReturnType<typeof loadConfig>>) => Promise<void>,
): Promise<void> {
  // No credentials are touched here — only arithmetic over rows already stored.
  const config = await loadConfig({ requireKms: false });
  try {
    const { rows: orgs } = await config.adminPool.query<{ id: string; name: string }>(
      orgName
        ? `SELECT id, name FROM organizations WHERE name = $1 AND deleted_at IS NULL`
        : `SELECT id, name FROM organizations WHERE deleted_at IS NULL ORDER BY created_at`,
      orgName ? [orgName] : [],
    );

    if (orgs.length === 0) {
      console.log(`\n${fmt.dim('No organizations. Run `demo` or `connect` first.')}\n`);
      return;
    }

    for (const org of orgs) {
      await fn(org, { orgId: org.id, actor: { type: 'system', jobName: 'forecast-job' } }, config);
    }
  } finally {
    await config.pool.end();
    await config.adminPool.end();
  }
}

/** Generate and record today's forecast for every organization. */
export async function forecastRecord(args: { orgName?: string } = {}): Promise<void> {
  await forEachOrg(args.orgName, async (org, ctx, config) => {
    const forecast = await buildCashForecast(config.pool, org.id);
    const { created } = await forecastsRepo.saveForecastDaily(config.pool, ctx, forecast);
    console.log(
      `\n${fmt.bold(org.name)}  ${created ? fmt.cyan('recorded') : fmt.dim('already recorded today')}` +
        `  ${fmt.dim(`${forecast.points.length}d horizon · ${forecast.confidence} confidence`)}`,
    );
  });
}

/**
 * Re-run today's engine over past dates so there is an accuracy baseline now
 * rather than in a quarter.
 *
 * These are stored as backfilled and never averaged with real forecasts — see
 * migration 0007 for the two reasons they are a weaker claim. What they are good
 * for: catching an engine that is badly calibrated before ninety days of real
 * forecasts say the same thing more slowly.
 */
export async function forecastBackfill(
  args: { orgName?: string; days?: number; every?: number } = {},
): Promise<void> {
  const days = args.days ?? 365;
  const every = args.every ?? 7;

  await forEachOrg(args.orgName, async (org, ctx, config) => {
    console.log(`\n${fmt.bold(org.name)}  ${fmt.dim(`backfilling every ${every}d over ${days}d`)}`);
    let created = 0;
    let skipped = 0;

    // Oldest first, so an interrupted run leaves a contiguous history rather
    // than a series with holes in the middle.
    for (let back = days; back >= 0; back -= every) {
      const asOf = new Date(Date.now() - back * 86400000);
      const forecast = await buildCashForecast(config.pool, org.id, { asOf });

      // The engine stamps generatedAt with the wall clock. For a backfill the
      // claim is about `asOf`, and storing "now" would make every backfilled
      // forecast look like it was made today — which would break scoring
      // entirely, since no horizon would ever have come due.
      const dated = { ...forecast, generatedAt: asOf.toISOString() };

      const res = await forecastsRepo.saveForecastDaily(config.pool, ctx, dated, 'cash', true);
      if (res.created) created++;
      else skipped++;
    }

    console.log(`  ${fmt.cyan(`${created} recorded`)}${skipped > 0 ? fmt.dim(` · ${skipped} already present`) : ''}`);
  });
}

/** Score every forecast whose horizons have come due and the books can support. */
export async function forecastScore(args: { orgName?: string } = {}): Promise<void> {
  await forEachOrg(args.orgName, async (org, ctx, config) => {
    const summary = await forecastsRepo.scoreDueForecasts(config.pool, ctx);
    console.log(`\n${fmt.bold(org.name)}`);

    if (summary.scored.length === 0) {
      console.log(
        `  ${fmt.dim(
          `nothing newly scored` +
            (summary.deferredForMissingData > 0
              ? ` · ${summary.deferredForMissingData} deferred — books do not reach the target date yet`
              : '') +
            (summary.alreadyScored > 0 ? ` · ${summary.alreadyScored} already scored` : ''),
        )}`,
      );
      return;
    }

    console.log(
      table(
        summary.scored.map((s) => ({
          horizon: `${s.horizonDays}d`,
          target: s.targetDate,
          predicted: usd(s.predictedP50Minor),
          actual: usd(s.actualMinor),
          error: `${(s.absPctError * 100).toFixed(1)}%`,
          band: s.withinBand ? 'in' : 'OUT',
        })),
      ),
    );
    if (summary.deferredForMissingData > 0) {
      console.log(`  ${fmt.dim(`${summary.deferredForMissingData} deferred — books do not reach the target date yet`)}`);
    }
  });
}

/** Read the flywheel back. */
export async function forecastAccuracy(args: { orgName?: string } = {}): Promise<void> {
  await forEachOrg(args.orgName, async (org, ctx, config) => {
    const buckets = await forecastsRepo.accuracySummary(config.pool, ctx);
    console.log(`\n${fmt.bold(org.name)}`);

    if (buckets.length === 0) {
      // Not zero. Nothing has been scored, which is a different claim.
      console.log(`  ${fmt.dim('no scored forecasts yet — accuracy is unknown, not zero')}`);
      return;
    }

    console.log(
      table(
        buckets.map((b) => ({
          kind: b.isBackfilled ? 'backfill' : 'live',
          horizon: `${b.horizonDays}d`,
          n: b.n,
          'median error': `${(b.medianAbsPctError * 100).toFixed(1)}%`,
          // An honest P10-P90 band contains the actual about 80% of the time.
          'band coverage': `${(b.bandCoverage * 100).toFixed(0)}%`,
          // Persistently non-zero means bias, which is fixable; noise is not.
          bias: usd(b.meanSignedErrorMinor),
          engine: b.methodVersion,
        })),
      ),
    );
    console.log(
      `  ${fmt.dim('bias = mean signed error. Consistently positive means the engine over-predicts cash.')}`,
    );
    if (buckets.some((b) => b.isBackfilled)) {
      console.log(
        `  ${fmt.dim('backfill rows re-run today\'s engine over tidied books — a weaker claim, never mixed with live.')}`,
      );
    }
  });
}

const usd = (minor: number): string =>
  (minor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
