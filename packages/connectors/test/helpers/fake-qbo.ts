import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * A fake QuickBooks Online API.
 *
 * A real HTTP server rather than a mocked fetch, because the behaviours we most
 * need to verify are protocol-level: 1-indexed pagination, 429 with Retry-After,
 * token expiry mid-stream, and refresh-token rotation. Mocking `fetch` would let
 * us assert that our code does what we already believe it does; a server makes
 * the adapter genuinely exercise the wire format.
 *
 * It deliberately reproduces QBO's real quirks, including the ones that have
 * caused production bugs in other integrations:
 *   - STARTPOSITION is 1-indexed
 *   - the entity array is OMITTED (not empty) when a result set is exhausted
 *   - refresh tokens rotate and the previous one becomes invalid immediately
 *   - 401 on an expired access token, mid-pagination
 */

export interface FakeQboOptions {
  /** Records per record type. */
  readonly data?: Record<string, unknown[]>;
  /** Access token lifetime in ms. Short values force a mid-backfill refresh. */
  readonly tokenTtlMs?: number;
  /** Return 429 on these 1-based request ordinals. */
  readonly throttleOnRequests?: number[];
  /** Return 500 on these 1-based request ordinals. */
  readonly failOnRequests?: number[];
  readonly retryAfterSeconds?: number;
}

export interface FakeQbo {
  readonly url: string;
  readonly tokenUrl: string;
  close(): Promise<void>;
  /** Requests served, excluding token endpoint calls. */
  readonly requestCount: number;
  readonly queryLog: string[];
  readonly issuedRefreshTokens: string[];
  /** Force the current access token to be treated as expired. */
  expireAccessToken(): void;
  readonly currentAccessToken: string;
  readonly currentRefreshToken: string;
}

const REALM_ID = '4620816365320125repeat';

export async function startFakeQbo(options: FakeQboOptions = {}): Promise<FakeQbo> {
  const data = options.data ?? {};
  const tokenTtlMs = options.tokenTtlMs ?? 3600_000;
  const throttleOn = new Set(options.throttleOnRequests ?? []);
  const failOn = new Set(options.failOnRequests ?? []);

  let accessToken = `access_${randomUUID()}`;
  let refreshToken = `refresh_${randomUUID()}`;
  let tokenExpiresAt = Date.now() + tokenTtlMs;
  const issuedRefreshTokens: string[] = [refreshToken];
  const queryLog: string[] = [];
  let requestCount = 0;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // ── token endpoint ──────────────────────────────────────────────────────
    if (url.pathname === '/oauth2/v1/tokens/bearer') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const grant = params.get('grant_type');

        if (grant === 'refresh_token') {
          const presented = params.get('refresh_token');
          // QBO invalidates the old refresh token the moment a new one is issued.
          // Presenting a stale one is a hard failure requiring reconnection.
          if (presented !== refreshToken) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant' }));
            return;
          }
        }

        accessToken = `access_${randomUUID()}`;
        refreshToken = `refresh_${randomUUID()}`;
        issuedRefreshTokens.push(refreshToken);
        tokenExpiresAt = Date.now() + tokenTtlMs;

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: Math.floor(tokenTtlMs / 1000),
            token_type: 'bearer',
          }),
        );
      });
      return;
    }

    // ── API endpoints ───────────────────────────────────────────────────────
    requestCount += 1;

    if (throttleOn.has(requestCount)) {
      res.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': String(options.retryAfterSeconds ?? 1),
      });
      res.end(JSON.stringify({ fault: { type: 'ThrottleExceeded' } }));
      return;
    }

    if (failOn.has(requestCount)) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ fault: { type: 'ServiceUnavailable' } }));
      return;
    }

    const auth = req.headers.authorization ?? '';
    const presentedToken = auth.replace(/^Bearer\s+/i, '');
    if (presentedToken !== accessToken || Date.now() > tokenExpiresAt) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ fault: { type: 'AUTHENTICATION' } }));
      return;
    }

    if (url.pathname.includes('/companyinfo/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ CompanyInfo: { CompanyName: 'Fake Co', Id: REALM_ID } }));
      return;
    }

    // ── Reports ──────────────────────────────────────────────────────────────
    //
    // The P&L is computed HERE, from the same entity payloads this server hands
    // out — the way QuickBooks derives it from the ledger. That independence is
    // the entire point: if it simply echoed a total it was handed, reconciling
    // against it would prove nothing except that arithmetic is deterministic.
    // Because it walks the raw Invoice/Purchase/Bill lines and groups by the
    // chart of accounts, a normalization bug on our side shows up as a real
    // disagreement.
    if (url.pathname.includes('/reports/ProfitAndLoss')) {
      const start = url.searchParams.get('start_date') ?? '1900-01-01';
      const end = url.searchParams.get('end_date') ?? '2999-12-31';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(buildProfitAndLoss(data, start, end)));
      return;
    }

    if (url.pathname.endsWith('/query')) {
      const query = url.searchParams.get('query') ?? '';
      queryLog.push(query);

      const countMatch = /SELECT COUNT\(\*\) FROM (\w+)/i.exec(query);
      if (countMatch) {
        const type = countMatch[1] as string;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ QueryResponse: { totalCount: (data[type] ?? []).length } }));
        return;
      }

      const selectMatch = /SELECT \* FROM (\w+)/i.exec(query);
      const startMatch = /STARTPOSITION (\d+)/i.exec(query);
      const maxMatch = /MAXRESULTS (\d+)/i.exec(query);

      const recordType = selectMatch?.[1] ?? 'Unknown';
      // 1-indexed, exactly as QBO does it. An adapter that assumes 0-indexing
      // silently drops the first record of every page against this server.
      const startPosition = Number(startMatch?.[1] ?? 1);
      const maxResults = Number(maxMatch?.[1] ?? 500);

      const all = data[recordType] ?? [];
      const page = all.slice(startPosition - 1, startPosition - 1 + maxResults);

      // QBO OMITS the entity key entirely when there are no more results, rather
      // than returning an empty array.
      const queryResponse: Record<string, unknown> = {
        startPosition,
        maxResults: page.length,
      };
      if (page.length > 0) queryResponse[recordType] = page;

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ QueryResponse: queryResponse, time: new Date().toISOString() }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ fault: { type: 'NotFound' } }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('Failed to bind fake QBO');
  const base = `http://127.0.0.1:${address.port}`;

  return {
    url: `${base}/v3/company`,
    tokenUrl: `${base}/oauth2/v1/tokens/bearer`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    get requestCount() {
      return requestCount;
    },
    queryLog,
    issuedRefreshTokens,
    expireAccessToken() {
      tokenExpiresAt = Date.now() - 1;
    },
    get currentAccessToken() {
      return accessToken;
    },
    get currentRefreshToken() {
      return refreshToken;
    },
  };
}

/** Deterministic fake QBO records. */
export function makeRecords(recordType: string, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    Id: String(i + 1),
    // QBO returns amounts as JSON numbers; converting them to Money at the
    // normalization boundary is sprint 3's problem, not the adapter's.
    TotalAmt: Number(((i + 1) * 13.37).toFixed(2)),
    MetaData: {
      CreateTime: new Date(Date.UTC(2024, 0, 1 + (i % 500))).toISOString(),
      LastUpdatedTime: new Date(Date.UTC(2024, 0, 1 + (i % 500))).toISOString(),
    },
    __type: recordType,
  }));
}

export const FAKE_REALM_ID = REALM_ID;

/**
 * Derive a ProfitAndLoss report from raw entity payloads, in QuickBooks' own
 * nested report shape.
 *
 * Two things are reproduced on purpose because they break naive parsers:
 *
 *   - **Sub-account nesting.** Payroll accounts are emitted as children of a
 *     parent row that ALSO carries a Summary. A walker that sums every row it
 *     meets double-counts them.
 *   - **Positional ColData.** Values live at the end of an array, not under a
 *     named key, and amounts are decimal strings.
 */
interface QboRef { value?: string; name?: string }
interface QboLine {
  Amount?: number;
  SalesItemLineDetail?: { ItemAccountRef?: QboRef };
  AccountBasedExpenseLineDetail?: { AccountRef?: QboRef };
}
interface QboDoc { TxnDate?: string; Line?: QboLine[] }

export function buildProfitAndLoss(
  data: Record<string, unknown[]>,
  start: string,
  end: string,
): unknown {
  type Acct = { Id: string; Name: string; AccountType: string };
  const accounts = (data['Account'] ?? []) as Acct[];
  const byId = new Map(accounts.map((a) => [a.Id, a]));
  const byName = new Map(accounts.map((a) => [a.Name, a]));

  const inRange = (d: string): boolean => d >= start && d <= end;
  const totals = new Map<string, number>(); // account name -> minor units

  const add = (name: string, minor: number): void =>
    void totals.set(name, (totals.get(name) ?? 0) + minor);
  const minor = (n: number): number => Math.round(n * 100);

  // Income: invoice lines, by the income account each line points at. Accrual —
  // dated on TxnDate, not when the invoice was paid.
  for (const raw of (data['Invoice'] ?? []) as QboDoc[]) {
    if (!inRange(String(raw.TxnDate))) continue;
    for (const line of raw.Line ?? []) {
      const ref = line.SalesItemLineDetail?.ItemAccountRef;
      if (!ref) continue;
      const acct = byId.get(String(ref.value)) ?? byName.get(String(ref.name));
      if (acct) add(acct.Name, minor(Number(line.Amount ?? 0)));
    }
  }

  // Costs: expense lines from Purchase and Bill alike. Both are accrual
  // documents in QBO and both land on the P&L.
  for (const key of ['Purchase', 'Bill']) {
    for (const raw of (data[key] ?? []) as QboDoc[]) {
      if (!inRange(String(raw.TxnDate))) continue;
      for (const line of raw.Line ?? []) {
        const ref = line.AccountBasedExpenseLineDetail?.AccountRef;
        if (!ref) continue;
        const acct = byId.get(String(ref.value)) ?? byName.get(String(ref.name));
        if (acct) add(acct.Name, minor(Number(line.Amount ?? 0)));
      }
    }
  }

  const dollars = (m: number): string => (m / 100).toFixed(2);
  const leaf = (name: string, m: number): unknown => ({
    type: 'Data',
    ColData: [{ value: name }, { value: dollars(m) }],
  });

  const forType = (type: string): Array<[string, number]> =>
    [...totals.entries()]
      .filter(([name]) => byName.get(name)?.AccountType === type)
      .sort(([a], [b]) => a.localeCompare(b));

  const income = forType('Income');
  const cogs = forType('Cost of Goods Sold');
  const expense = forType('Expense');

  const sum = (rows: Array<[string, number]>): number => rows.reduce((s, [, m]) => s + m, 0);

  // Payroll accounts nest under a parent that also carries a Summary. This is
  // the sub-account shape that double-counts a naive parser.
  const payrollNames = new Set(['Salaries & Wages', 'Payroll Taxes', 'Employee Benefits']);
  const payroll = expense.filter(([n]) => payrollNames.has(n));
  const flatExpense = expense.filter(([n]) => !payrollNames.has(n));

  const expenseRows: unknown[] = flatExpense.map(([n, m]) => leaf(n, m));
  if (payroll.length > 0) {
    expenseRows.unshift({
      type: 'Section',
      Header: { ColData: [{ value: 'Payroll Expenses' }] },
      Rows: { Row: payroll.map(([n, m]) => leaf(n, m)) },
      Summary: { ColData: [{ value: 'Total Payroll Expenses' }, { value: dollars(sum(payroll)) }] },
    });
  }

  const section = (group: string, label: string, rows: unknown[], total: number): unknown => ({
    type: 'Section',
    group,
    Header: { ColData: [{ value: label }] },
    Rows: { Row: rows },
    Summary: { ColData: [{ value: `Total ${label}` }, { value: dollars(total) }] },
  });

  const incomeTotal = sum(income);
  const cogsTotal = sum(cogs);
  const expenseTotal = sum(expense);

  return {
    Header: { StartPeriod: start, EndPeriod: end, ReportName: 'ProfitAndLoss', Currency: 'USD' },
    Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Total' }] },
    Rows: {
      Row: [
        section('Income', 'Income', income.map(([n, m]) => leaf(n, m)), incomeTotal),
        section('COGS', 'Cost of Goods Sold', cogs.map(([n, m]) => leaf(n, m)), cogsTotal),
        {
          type: 'Section',
          group: 'GrossProfit',
          Summary: { ColData: [{ value: 'Gross Profit' }, { value: dollars(incomeTotal - cogsTotal) }] },
        },
        section('Expenses', 'Expenses', expenseRows, expenseTotal),
        {
          type: 'Section',
          group: 'NetIncome',
          Summary: {
            ColData: [
              { value: 'Net Income' },
              { value: dollars(incomeTotal - cogsTotal - expenseTotal) },
            ],
          },
        },
      ],
    },
  };
}
