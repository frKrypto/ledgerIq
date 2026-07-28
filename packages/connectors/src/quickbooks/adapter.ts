import { HttpClient, HttpError, RateLimiter, CircuitBreaker } from '../http.js';
import type {
  ConnectionCredentials,
  ConnectionHealth,
  ConnectionRef,
  ConnectorAdapter,
  RawBatch,
  ReconciliationReport,
  SyncOptions,
} from '../adapter.js';

/**
 * QuickBooks Online adapter — the anchor integration.
 *
 * QBO holds the accrual truth: categorized revenue and expense, AR, AP, chart of
 * accounts, customers, vendors. It is the most important connector and the one
 * whose quirks shape this file.
 *
 * Things that are QBO-specific and non-obvious:
 *
 *   - Pagination is 1-INDEXED (STARTPOSITION 1, not 0), and MAXRESULTS caps at
 *     1000. Off-by-one here silently skips the first record of every page.
 *   - The query language is SQL-ish but not SQL. String literals need escaping
 *     and there are no bind parameters, so filter values must be sanitised.
 *   - Rate limits are per-realm, roughly 500 requests/minute, and exceeding them
 *     yields 429s that escalate.
 *   - Access tokens live ~1 hour; refresh tokens ~100 days and ROTATE on every
 *     refresh. Losing a rotated refresh token means the customer must reconnect,
 *     so persistence of the new token has to be durable before it is used.
 *   - Deleted records vanish from queries entirely rather than being tombstoned,
 *     which is a large part of why the raw archive exists.
 */

const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QBO_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

const PAGE_SIZE = 500;
const MINOR_VERSION = '75';

/** Synced in dependency order: entities before the documents that reference them. */
export const QBO_RECORD_TYPES = [
  'Account',
  'Customer',
  'Vendor',
  'Item',
  'Invoice',
  'Payment',
  'Bill',
  'BillPayment',
  'Purchase',
  'Deposit',
  'JournalEntry',
  'Transfer',
] as const;

export type QboRecordType = (typeof QBO_RECORD_TYPES)[number];

interface QboQueryResponse {
  QueryResponse?: Record<string, unknown> & { startPosition?: number; maxResults?: number };
  time?: string;
}

export interface QuickBooksConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly sandbox?: boolean;
  readonly httpClient?: HttpClient;
  readonly apiBase?: string;
  readonly tokenUrl?: string;
  /**
   * Persist rotated refresh tokens. QBO rotates the refresh token on every
   * refresh and invalidates the previous one, so this must be durable BEFORE the
   * new access token is used — otherwise a crash between refresh and save
   * strands the connection and the customer has to reconnect.
   */
  readonly onCredentialsRotated?: (connectionId: string, next: ConnectionCredentials) => Promise<void>;
}

/**
 * Escape a string literal for the QBO query language.
 *
 * There are no bind parameters, so this is the only defence. A customer name
 * containing an apostrophe is common and would otherwise break the query or, in
 * the bad case, alter it.
 */
export function escapeQboLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildQuery(
  recordType: string,
  opts: { startPosition: number; pageSize: number; since?: Date | undefined },
): string {
  const clauses: string[] = [`SELECT * FROM ${recordType}`];
  if (opts.since) {
    // MetaData.LastUpdatedTime is the only reliable incremental filter; CreateTime
    // misses edits to historical records, which silently produces stale figures.
    clauses.push(`WHERE MetaData.LastUpdatedTime >= '${escapeQboLiteral(opts.since.toISOString())}'`);
  }
  clauses.push(`ORDERBY MetaData.LastUpdatedTime ASC`);
  clauses.push(`STARTPOSITION ${opts.startPosition}`);
  clauses.push(`MAXRESULTS ${opts.pageSize}`);
  return clauses.join(' ');
}

export class QuickBooksAdapter implements ConnectorAdapter {
  readonly source = 'quickbooks' as const;
  readonly kind = 'accounting' as const;
  readonly recordTypes = QBO_RECORD_TYPES;

  readonly #config: QuickBooksConfig;
  readonly #http: HttpClient;
  readonly #apiBase: string;
  readonly #tokenUrl: string;

  constructor(config: QuickBooksConfig) {
    this.#config = config;
    this.#apiBase = config.apiBase ?? (config.sandbox ? QBO_SANDBOX_BASE : QBO_API_BASE);
    this.#tokenUrl = config.tokenUrl ?? QBO_TOKEN_URL;
    this.#http =
      config.httpClient ??
      new HttpClient({
        provider: 'quickbooks',
        // ~500 req/min per realm; stay comfortably under rather than discovering
        // the ceiling through 429s.
        rateLimiter: new RateLimiter(40, 7),
        circuitBreaker: new CircuitBreaker('quickbooks'),
      });
  }

  // ── auth ───────────────────────────────────────────────────────────────────

  async authorize(params: {
    code: string;
    redirectUri: string;
    realmId?: string;
  }): Promise<ConnectionCredentials> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
    });
    return this.#tokenRequest(body, params.realmId);
  }

  async refresh(credentials: ConnectionCredentials): Promise<ConnectionCredentials> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    });
    return this.#tokenRequest(body, credentials.externalAccountId);
  }

  async #tokenRequest(
    body: URLSearchParams,
    externalAccountId?: string,
  ): Promise<ConnectionCredentials> {
    const basic = Buffer.from(
      `${this.#config.clientId}:${this.#config.clientSecret}`,
      'utf8',
    ).toString('base64');

    const response = await this.#http.request(this.#tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const parsed = JSON.parse(response.body) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: parsed.access_token,
      // QBO rotates this on every refresh; the old one is immediately invalid.
      refreshToken: parsed.refresh_token,
      expiresAt: new Date(Date.now() + parsed.expires_in * 1000),
      ...(externalAccountId !== undefined ? { externalAccountId } : {}),
    };
  }

  /**
   * Refresh proactively when the token is close to expiry.
   *
   * A 60-second skew guard avoids the race where a token is valid at the check
   * and expired by the time the request lands mid-backfill.
   */
  async ensureFreshCredentials(connection: ConnectionRef): Promise<ConnectionCredentials> {
    const SKEW_MS = 60_000;
    if (connection.credentials.expiresAt.getTime() - Date.now() > SKEW_MS) {
      return connection.credentials;
    }
    const next = await this.refresh(connection.credentials);
    await this.#config.onCredentialsRotated?.(connection.id, next);
    return next;
  }

  // ── sync ───────────────────────────────────────────────────────────────────

  /**
   * Paginated fetch, resumable from a checkpoint.
   *
   * The generator yields each page as it arrives rather than accumulating: a
   * 24-month backfill of a busy company is hundreds of thousands of records, and
   * buffering it produces an OOM at exactly the wrong moment.
   */
  async *fullSync(
    connection: ConnectionRef,
    recordType: string,
    options: SyncOptions = {},
  ): AsyncIterable<RawBatch> {
    // QBO pagination is 1-indexed. Starting at 0 silently drops the first record
    // of the first page.
    let startPosition = Number(options.checkpoint?.['startPosition'] ?? 1);
    let pageIndex = Number(options.checkpoint?.['pageIndex'] ?? 0);

    const credentials = await this.ensureFreshCredentials(connection);
    const realmId = connection.externalAccountId ?? credentials.externalAccountId;
    if (!realmId) throw new Error('QuickBooks connection is missing a realmId');

    for (;;) {
      options.signal?.throwIfAborted();

      const query = buildQuery(recordType, {
        startPosition,
        pageSize: PAGE_SIZE,
        since: options.since,
      });
      const url =
        `${this.#apiBase}/${realmId}/query` +
        `?minorversion=${MINOR_VERSION}&query=${encodeURIComponent(query)}`;

      const response = await this.#http.request(url, { accessToken: credentials.accessToken });
      const parsed = JSON.parse(response.body) as QboQueryResponse;

      const records = (parsed.QueryResponse?.[recordType] as unknown[] | undefined) ?? [];
      // QBO signals the end of a result set by omitting the entity array or
      // returning fewer rows than requested. There is no total count.
      const hasMore = records.length === PAGE_SIZE;

      yield {
        recordType,
        records,
        rawResponse: parsed,
        pageIndex,
        hasMore,
        // The checkpoint written AFTER this page is durably archived, so a crash
        // resumes at this page rather than skipping it.
        cursor: { startPosition: startPosition + records.length, pageIndex: pageIndex + 1 },
        ...(options.since ? { windowStart: options.since } : {}),
      };

      if (!hasMore) return;
      startPosition += records.length;
      pageIndex += 1;
    }
  }

  async *incrementalSync(
    connection: ConnectionRef,
    recordType: string,
    cursor: Record<string, unknown>,
  ): AsyncIterable<RawBatch> {
    // Narrow explicitly: an object here would stringify to "[object Object]"
    // and silently produce an Invalid Date, which would then be sent to QBO as a
    // filter and quietly return the wrong window.
    const raw = cursor['lastUpdatedTime'];
    const since =
      typeof raw === 'string' || typeof raw === 'number' || raw instanceof Date
        ? new Date(raw)
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    yield* this.fullSync(connection, recordType, { since });
  }

  // ── health & reconciliation ────────────────────────────────────────────────

  async healthCheck(connection: ConnectionRef): Promise<ConnectionHealth> {
    try {
      const credentials = await this.ensureFreshCredentials(connection);
      const realmId = connection.externalAccountId ?? credentials.externalAccountId;
      const url = `${this.#apiBase}/${realmId}/companyinfo/${realmId}?minorversion=${MINOR_VERSION}`;
      await this.#http.request(url, { accessToken: credentials.accessToken });
      return { status: 'healthy' };
    } catch (err) {
      if (err instanceof HttpError) {
        // 401/403 after a refresh attempt means the customer revoked access or
        // changed their password — user action is required, and the product
        // surfaces this as reauth_required rather than a generic error.
        if (err.status === 401 || err.status === 403) {
          return { status: 'reauth_required', reason: 'QuickBooks authorization is no longer valid' };
        }
        if (err.status === 429) {
          return { status: 'degraded', reason: 'Rate limited by QuickBooks' };
        }
        return { status: 'error', reason: `QuickBooks returned ${err.status}` };
      }
      return { status: 'error', reason: (err as Error).message };
    }
  }

  /**
   * Compare our record count against QBO's own COUNT(*).
   *
   * Catches the failure that health checks miss: an API returning 200 with
   * subtly incomplete data. Silent under-fetching yields confidently wrong
   * metrics with no error anywhere.
   */
  /**
   * Fetch one of QuickBooks' own reports.
   *
   * Distinct from entity sync on purpose: reports are QuickBooks' answer, not its
   * data. We never store them as facts — they exist so we can check our answer
   * against theirs. If those two ever disagree, the source system is right and we
   * are wrong, and finding that out is worth an extra API call.
   *
   * Errors are NOT swallowed here, unlike `reconcile` below. A reconciliation run
   * that silently returns nothing when the API has a bad minute would report
   * agreement, which is the one wrong answer this whole path exists to prevent.
   */
  async fetchReport(
    connection: ConnectionRef,
    reportName: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const credentials = await this.ensureFreshCredentials(connection);
    const realmId = connection.externalAccountId ?? credentials.externalAccountId;
    const query = new URLSearchParams({ minorversion: String(MINOR_VERSION), ...params });
    const url = `${this.#apiBase}/${realmId}/reports/${reportName}?${query.toString()}`;

    const response = await this.#http.request(url, { accessToken: credentials.accessToken });
    return JSON.parse(response.body) as unknown;
  }

  async reconcile(
    connection: ConnectionRef,
    recordType: string,
    ourCount: number,
  ): Promise<ReconciliationReport> {
    const credentials = await this.ensureFreshCredentials(connection);
    const realmId = connection.externalAccountId ?? credentials.externalAccountId;
    const query = `SELECT COUNT(*) FROM ${recordType}`;
    const url =
      `${this.#apiBase}/${realmId}/query` +
      `?minorversion=${MINOR_VERSION}&query=${encodeURIComponent(query)}`;

    try {
      const response = await this.#http.request(url, { accessToken: credentials.accessToken });
      const parsed = JSON.parse(response.body) as QboQueryResponse;
      const providerCount = Number(parsed.QueryResponse?.['totalCount'] ?? NaN);

      return {
        recordType,
        ourCount,
        providerCount: Number.isFinite(providerCount) ? providerCount : null,
        divergent: Number.isFinite(providerCount) && providerCount !== ourCount,
      };
    } catch {
      // A failed reconciliation is not itself a divergence — reporting it as one
      // would produce false alarms every time QBO has a bad minute.
      return { recordType, ourCount, providerCount: null, divergent: false };
    }
  }
}
