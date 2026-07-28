import type { Pool } from 'pg';
import type {
  LineDiff,
  ReconciliationReport,
  Section,
  SourceProfitAndLoss,
} from './types.js';

/**
 * Compare the canonical model against a source system's own P&L.
 *
 * Two decisions worth stating, because both are places where a reconciler can
 * quietly stop being useful:
 *
 * **Tolerance is zero.** Not "within a dollar", not "within 0.5%". Accounting
 * either agrees or it does not, and a tolerance is a place for a real mapping bug
 * to hide indefinitely — a $40 systematic drift on a $3M business is inside any
 * reasonable percentage tolerance and is still a bug. If a rounding difference is
 * ever legitimate, it should be understood and fixed at the source, not absorbed
 * here.
 *
 * **Accrual timing.** A P&L is an accrual statement, so this reads `occurred_at`,
 * not `posted_at`. Comparing our cash-settled view against the source's accrual
 * view would produce a large, permanent, meaningless divergence — and would be an
 * easy mistake to make, since the forecast engine two files over correctly uses
 * the opposite column.
 */

const STATEMENT_TO_SECTION: Record<string, Section | null> = {
  revenue: 'income',
  cogs: 'cogs',
  opex: 'expense',
  payroll: 'expense',
  // Deliberately excluded from the P&L comparison: QuickBooks reports "Other
  // Income/Expense" below the net-income line, so folding them in would create a
  // divergence that is a presentation difference rather than a data error.
  other_income: null,
  other_expense: null,
  asset: null,
  liability: null,
  equity: null,
};

interface CanonicalRow {
  account_name: string | null;
  statement: string | null;
  total: string;
}

export async function reconcileProfitAndLoss(
  pool: Pool,
  orgId: string,
  source: SourceProfitAndLoss,
): Promise<ReconciliationReport> {
  const client = await pool.connect();
  let rows: CanonicalRow[];
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', orgId]);
    const res = await client.query<CanonicalRow>(
      `SELECT la.name AS account_name,
              t.statement::text AS statement,
              sum(t.amount) AS total
         FROM transactions t
         LEFT JOIN ledger_accounts la ON la.id = t.ledger_account_id
        WHERE t.occurred_at >= $1::date AND t.occurred_at <= $2::date
          AND t.is_canonical AND NOT t.is_transfer AND t.voided_at IS NULL
        GROUP BY la.name, t.statement`,
      [source.start, source.end],
    );
    await client.query('COMMIT');
    rows = res.rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const canonicalByAccount = new Map<string, number>();
  const canonicalBySection: Record<Section, number> = { income: 0, cogs: 0, expense: 0 };

  for (const row of rows) {
    const section = STATEMENT_TO_SECTION[row.statement ?? ''] ?? null;
    if (section === null) continue;
    const minor = Math.round(Number(row.total) * 100);
    canonicalBySection[section] += minor;
    // An unmapped account still counts towards its section total; naming it
    // "(unmapped)" makes it visible in the per-account diff rather than silently
    // widening one line.
    const name = row.account_name ?? '(unmapped)';
    canonicalByAccount.set(name, (canonicalByAccount.get(name) ?? 0) + minor);
  }

  const sections: LineDiff[] = [
    diff('Income', source.totals.income, canonicalBySection.income),
    diff('Cost of goods sold', source.totals.cogs, canonicalBySection.cogs),
    diff('Expenses', source.totals.expenses, canonicalBySection.expense),
    diff(
      'Net income',
      source.totals.netIncome,
      canonicalBySection.income - canonicalBySection.cogs - canonicalBySection.expense,
    ),
  ];

  const accounts: LineDiff[] = [];
  const seen = new Set<string>();
  for (const line of source.lines) {
    seen.add(line.accountName);
    accounts.push(diff(line.accountName, line.amountMinor, canonicalByAccount.get(line.accountName) ?? null));
  }
  // Accounts we have that the source's P&L does not. Usually a transaction
  // mapped into the P&L that belongs on the balance sheet — which is exactly the
  // sort of mistake a row-count check would never surface.
  for (const [name, minor] of canonicalByAccount) {
    if (!seen.has(name)) accounts.push(diff(name, null, minor));
  }
  accounts.sort((a, b) => Math.abs(b.deltaMinor) - Math.abs(a.deltaMinor));

  const all = [...sections, ...accounts];
  const diverged = all.filter((d) => d.status !== 'match');
  const largest = diverged.reduce<LineDiff | null>(
    (worst, d) => (worst === null || Math.abs(d.deltaMinor) > Math.abs(worst.deltaMinor) ? d : worst),
    null,
  );

  return {
    start: source.start,
    end: source.end,
    ok: diverged.length === 0,
    sections,
    accounts,
    summary: {
      matched: all.length - diverged.length,
      diverged: diverged.length,
      largestDeltaMinor: largest?.deltaMinor ?? 0,
      largestDeltaLabel: largest?.label ?? null,
    },
  };
}

function diff(label: string, sourceMinor: number | null, canonicalMinor: number | null): LineDiff {
  const s = sourceMinor ?? 0;
  const c = canonicalMinor ?? 0;
  const delta = c - s;

  const status =
    sourceMinor === null
      ? 'missing_in_source'
      : canonicalMinor === null
        ? 'missing_in_canonical'
        : delta === 0
          ? 'match'
          : 'diverged';

  return { label, sourceMinor: s, canonicalMinor: c, deltaMinor: delta, status };
}

/** Human-readable rendering, for the CLI and for failure messages in CI. */
export function formatReport(report: ReconciliationReport): string {
  const usd = (m: number): string =>
    (m / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const lines: string[] = [
    `Reconciliation ${report.start} → ${report.end}`,
    report.ok
      ? '  AGREES with the source system to the cent'
      : `  ${report.summary.diverged} line(s) DIVERGE — largest: ${report.summary.largestDeltaLabel} ` +
        `(${usd(report.summary.largestDeltaMinor)})`,
    '',
  ];

  for (const d of report.sections) {
    lines.push(
      `  ${d.status === 'match' ? 'ok  ' : 'DIFF'}  ${d.label.padEnd(22)}` +
        `source ${usd(d.sourceMinor).padStart(16)}   ours ${usd(d.canonicalMinor).padStart(16)}` +
        (d.deltaMinor === 0 ? '' : `   Δ ${usd(d.deltaMinor)}`),
    );
  }

  const badAccounts = report.accounts.filter((a) => a.status !== 'match');
  if (badAccounts.length > 0) {
    lines.push('', '  Accounts that disagree:');
    for (const d of badAccounts.slice(0, 20)) {
      lines.push(
        `    ${d.label.padEnd(30)} source ${usd(d.sourceMinor).padStart(14)}` +
          `   ours ${usd(d.canonicalMinor).padStart(14)}   Δ ${usd(d.deltaMinor)}` +
          (d.status === 'missing_in_source' ? '  [not on the source P&L]' : '') +
          (d.status === 'missing_in_canonical' ? '  [we have nothing here]' : ''),
      );
    }
  }

  return lines.join('\n');
}
