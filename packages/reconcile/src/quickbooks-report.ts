import type { Section, SourceAccountLine, SourceProfitAndLoss } from './types.js';

/**
 * Parse QuickBooks' ProfitAndLoss report into the flat shape the reconciler wants.
 *
 * The report API returns a recursively nested structure — sections containing
 * sections containing rows, each row a positional `ColData` array — and the
 * nesting depth varies with the chart of accounts. Sub-accounts arrive as a
 * nested `Rows` block whose parent also carries a `Summary`, so a naive walk that
 * sums every row it encounters double-counts every business that uses
 * sub-accounts. That is the specific bug this parser is written to avoid: when a
 * group has both children and a summary, the children are authoritative and the
 * summary is skipped.
 */

interface QboColData {
  value?: string;
  id?: string;
}
interface QboRow {
  type?: string;
  group?: string;
  Header?: { ColData?: QboColData[] };
  Rows?: { Row?: QboRow[] };
  Summary?: { ColData?: QboColData[] };
  ColData?: QboColData[];
}
export interface QboProfitAndLoss {
  Header?: { StartPeriod?: string; EndPeriod?: string };
  Rows?: { Row?: QboRow[] };
}

/** QBO's `group` values, mapped onto our sections. */
const GROUP_SECTION: Record<string, Section> = {
  Income: 'income',
  COGS: 'cogs',
  Expenses: 'expense',
};

export function parseQuickBooksProfitAndLoss(report: QboProfitAndLoss): SourceProfitAndLoss {
  const start = report.Header?.StartPeriod ?? '';
  const end = report.Header?.EndPeriod ?? '';

  const lines: SourceAccountLine[] = [];
  const groupTotals = new Map<string, number>();

  for (const row of report.Rows?.Row ?? []) {
    const group = row.group ?? '';
    const section = GROUP_SECTION[group];

    if (section) {
      collectLeaves(row, section, lines);
      groupTotals.set(group, summaryAmount(row));
      continue;
    }

    // GrossProfit and NetIncome arrive as summary-only rows with no children.
    if (group === 'GrossProfit' || group === 'NetIncome') {
      groupTotals.set(group, summaryAmount(row));
    }
  }

  const income = groupTotals.get('Income') ?? sumSection(lines, 'income');
  const cogs = groupTotals.get('COGS') ?? sumSection(lines, 'cogs');
  const expenses = groupTotals.get('Expenses') ?? sumSection(lines, 'expense');

  return {
    start,
    end,
    lines,
    totals: {
      income,
      cogs,
      expenses,
      grossProfit: groupTotals.get('GrossProfit') ?? income - cogs,
      netIncome: groupTotals.get('NetIncome') ?? income - cogs - expenses,
    },
  };
}

/**
 * Walk down to the account rows, never summing a parent that has children.
 *
 * A group with both `Rows` and `Summary` is a sub-account parent: its summary
 * repeats what its children already say. Taking both is the double-count.
 */
function collectLeaves(row: QboRow, section: Section, out: SourceAccountLine[]): void {
  const children = row.Rows?.Row ?? [];

  if (children.length > 0) {
    for (const child of children) collectLeaves(child, section, out);
    return;
  }

  const cols = row.ColData ?? [];
  const name = cols[0]?.value;
  const value = cols[cols.length - 1]?.value;
  if (!name || value === undefined) return;

  out.push({ accountName: name, section, amountMinor: toMinor(value) });
}

function summaryAmount(row: QboRow): number {
  const cols = row.Summary?.ColData ?? [];
  return toMinor(cols[cols.length - 1]?.value ?? '0');
}

function sumSection(lines: SourceAccountLine[], section: Section): number {
  return lines.filter((l) => l.section === section).reduce((s, l) => s + l.amountMinor, 0);
}

/**
 * Report values are decimal strings. Parsing to a float and multiplying by 100
 * loses cents on values like "1234.35" (→ 123434.99999...), so the string is
 * split instead. This is the same rule as @ledgeriq/core/money, applied at the
 * one boundary where money enters as text.
 */
function toMinor(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return 0;

  const negative = cleaned.startsWith('-') || (cleaned.startsWith('(') && cleaned.endsWith(')'));
  const digits = cleaned.replace(/^[-(]|\)$/g, '');
  const [whole = '0', frac = ''] = digits.split('.');
  const cents = `${frac}00`.slice(0, 2);
  const minor = Number(whole) * 100 + Number(cents);

  return negative ? -minor : minor;
}
