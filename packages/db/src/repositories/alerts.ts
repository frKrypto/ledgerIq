import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { AlertCandidate } from '@ledgeriq/alerts';
import { renderBody } from '@ledgeriq/alerts';
import { withTenant, type TenantContext } from '../tenant-context.js';

/**
 * The gate between "a rule fired" and "a human was interrupted."
 *
 * Rule evaluation is pure and cannot send anything (see @ledgeriq/alerts). This
 * is where the two stateful defences live:
 *
 *   - **Confirmation.** A candidate is recorded as an observation first. It
 *     becomes an alert only once it has been seen on enough consecutive
 *     evaluations. A probabilistic forecast throws off transient risks, and
 *     paging someone about one is how the mute button gets pressed.
 *
 *   - **Deduplication.** One alert per condition per org, ever, enforced by a
 *     unique constraint rather than by a query the caller has to remember.
 *
 * There is a third, subtler one: observations for risks that stopped appearing
 * are cleared. Without that, a risk seen once in January and once in March fires
 * in March as though it had been confirmed twice — the word "consecutive" would
 * be a comment rather than a behaviour.
 */

export interface RaisedAlert {
  readonly id: string;
  readonly ruleKey: string;
  readonly severity: string;
  readonly title: string;
  readonly body: string;
  readonly dedupKey: string;
  readonly confirmations: number;
}

export interface AlertRunSummary {
  readonly raised: RaisedAlert[];
  /** Seen, but not yet confirmed enough times to send. */
  readonly awaitingConfirmation: number;
  /** Already alerted on previously; suppressed. */
  readonly suppressedAsDuplicate: number;
  /** Observations dropped because the risk no longer appears. */
  readonly stale: number;
}

export async function processAlertCandidates(
  pool: Pool,
  ctx: TenantContext,
  candidates: readonly AlertCandidate[],
): Promise<AlertRunSummary> {
  return withTenant(pool, ctx, async (db) => {
    const raised: RaisedAlert[] = [];
    let awaiting = 0;
    let suppressed = 0;

    // sql.param, not bare interpolation: drizzle spreads a JS array into one
    // placeholder per element, which turns `= ANY($1::text[])` into a malformed
    // array literal the moment there is more than nothing.
    const liveKeys = candidates.map((c) => c.dedupKey);

    // Clear observations for risks that have gone away. Done first so a risk
    // that reappears in this same run starts its count over rather than
    // resuming a stale one.
    const staleResult = await db.execute<{ dedup_key: string }>(
      liveKeys.length > 0
        ? sql`DELETE FROM alert_observations
               WHERE dedup_key <> ALL(${sql.param(liveKeys)}::text[])
               RETURNING dedup_key`
        : sql`DELETE FROM alert_observations RETURNING dedup_key`,
    );

    for (const candidate of candidates) {
      // Already alerted? The unique constraint would catch it, but checking
      // first keeps the observation table from growing for a settled condition.
      const existing = await db.execute<{ id: string }>(
        sql`SELECT id FROM alerts WHERE dedup_key = ${candidate.dedupKey} LIMIT 1`,
      );
      if (existing.rows.length > 0) {
        suppressed++;
        continue;
      }

      const observed = await db.execute<{ sightings: number }>(
        sql`INSERT INTO alert_observations (org_id, dedup_key, rule_key, payload)
            VALUES (${ctx.orgId}::uuid, ${candidate.dedupKey}, ${candidate.ruleKey},
                    ${JSON.stringify(candidate.figures)}::jsonb)
            ON CONFLICT (org_id, dedup_key) DO UPDATE
              SET sightings = alert_observations.sightings + 1,
                  last_seen_at = now(),
                  payload = excluded.payload
            RETURNING sightings`,
      );
      const sightings = observed.rows[0]?.sightings ?? 1;

      if (sightings < candidate.confirmationsRequired) {
        awaiting++;
        continue;
      }

      const inserted = await db.execute<{ id: string }>(
        sql`INSERT INTO alerts
              (org_id, rule_key, severity, title, body, figures, recommended_action,
               dedup_key, materiality, confirmations)
            VALUES (${ctx.orgId}::uuid, ${candidate.ruleKey},
                    ${candidate.severity}::alert_severity,
                    ${candidate.title}, ${renderBody(candidate)},
                    ${JSON.stringify(candidate.figures)}::jsonb,
                    ${candidate.recommendedAction === null
                      ? null
                      : JSON.stringify(candidate.recommendedAction)}::jsonb,
                    ${candidate.dedupKey},
                    ${(candidate.materialityMinor / 100).toFixed(4)},
                    ${sightings})
            ON CONFLICT (org_id, dedup_key) DO NOTHING
            RETURNING id`,
      );

      const id = inserted.rows[0]?.id;
      if (id === undefined) {
        suppressed++;
        continue;
      }

      // The condition has produced its alert; the observation has done its job.
      await db.execute(
        sql`DELETE FROM alert_observations WHERE dedup_key = ${candidate.dedupKey}`,
      );

      raised.push({
        id,
        ruleKey: candidate.ruleKey,
        severity: candidate.severity,
        title: candidate.title,
        body: renderBody(candidate),
        dedupKey: candidate.dedupKey,
        confirmations: sightings,
      });
    }

    return {
      raised,
      awaitingConfirmation: awaiting,
      suppressedAsDuplicate: suppressed,
      stale: staleResult.rows.length,
    };
  });
}

/**
 * Mark a condition resolved when it stops appearing, so the same risk can fire
 * again if it genuinely returns later.
 *
 * Without this, dedup is permanent: a payroll shortfall warned about in March
 * and fixed would never warn again if it recurred in September, which is worse
 * than noise — it is silence exactly when the warning matters.
 */
export async function resolveVanishedAlerts(
  pool: Pool,
  ctx: TenantContext,
  liveDedupKeys: readonly string[],
): Promise<number> {
  return withTenant(pool, ctx, async (db) => {
    const result = await db.execute<{ id: string }>(
      liveDedupKeys.length > 0
        ? sql`UPDATE alerts SET state = 'resolved', resolved_at = now()
               WHERE state IN ('pending', 'sent', 'acknowledged')
                 AND dedup_key <> ALL(${sql.param(liveDedupKeys)}::text[])
               RETURNING id`
        : sql`UPDATE alerts SET state = 'resolved', resolved_at = now()
               WHERE state IN ('pending', 'sent', 'acknowledged')
               RETURNING id`,
    );
    return result.rows.length;
  });
}

export async function listOpenAlerts(pool: Pool, ctx: TenantContext): Promise<RaisedAlert[]> {
  return withTenant(pool, ctx, async (db) => {
    const r = await db.execute<{
      id: string; rule_key: string; severity: string; title: string;
      body: string; dedup_key: string; confirmations: number;
    }>(
      sql`SELECT id, rule_key, severity, title, body, dedup_key, confirmations
            FROM alerts
           WHERE state IN ('pending', 'sent', 'acknowledged')
           ORDER BY CASE severity
                      WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                      WHEN 'medium' THEN 2 ELSE 3 END,
                    triggered_at DESC`,
    );
    return r.rows.map((row) => ({
      id: row.id,
      ruleKey: row.rule_key,
      severity: row.severity,
      title: row.title,
      body: row.body,
      dedupKey: row.dedup_key,
      confirmations: Number(row.confirmations),
    }));
  });
}
