/**
 * HTTP client for provider APIs.
 *
 * Every connector will break. The design assumption throughout
 * (docs/03-engineering/architecture.md §7) is that provider failure is normal
 * operation, not an incident — so retry, rate limiting, and circuit breaking
 * live here rather than being sprinkled through each adapter.
 *
 * What this handles, and why each matters:
 *
 *   429 + Retry-After  QuickBooks throttles per realm. Ignoring Retry-After and
 *                      retrying immediately gets the connection throttled harder
 *                      and can escalate to a temporary ban.
 *   5xx                Transient. Retry with exponential backoff plus jitter —
 *                      without jitter, a fleet-wide provider blip produces a
 *                      synchronised retry stampede when it recovers.
 *   4xx                NOT retried. A 400 is a bug in our request; retrying it
 *                      just burns rate limit and hides the defect.
 *   401                Retried exactly once, after a token refresh.
 *   Circuit breaker    A sustained provider outage must not consume every worker
 *                      slot retrying doomed requests while other tenants' syncs
 *                      queue behind them.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'HttpError';
  }

  /** 429 and 5xx are worth another attempt; 4xx means we sent something wrong. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

export class CircuitOpenError extends Error {
  constructor(readonly provider: string, readonly retryAt: Date) {
    super(`Circuit breaker open for ${provider} until ${retryAt.toISOString()}`);
    this.name = 'CircuitOpenError';
  }
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/**
 * Full jitter exponential backoff.
 *
 * `random(0, min(cap, base * 2^attempt))` — the AWS "full jitter" formulation.
 * Plain exponential backoff synchronises retries across tenants after a shared
 * outage; jitter spreads them, which is the difference between a recovering
 * provider and a re-flattened one.
 */
export function backoffDelay(attempt: number, policy: RetryPolicy, random = Math.random): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/** Parse Retry-After, which may be seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Token-bucket rate limiter.
 *
 * QuickBooks allows a bounded request rate per realm. Self-limiting keeps us
 * under it rather than discovering the ceiling via 429s, which is both slower
 * and visible to the provider as misbehaviour.
 */
export class RateLimiter {
  #tokens: number;
  #lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.#tokens = capacity;
    this.#lastRefill = now();
  }

  /** Milliseconds the caller must wait before a token is available. */
  reserve(): number {
    const now = this.now();
    const elapsedSeconds = (now - this.#lastRefill) / 1000;
    this.#tokens = Math.min(this.capacity, this.#tokens + elapsedSeconds * this.refillPerSecond);
    this.#lastRefill = now;

    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      return 0;
    }
    const deficit = 1 - this.#tokens;
    this.#tokens = 0;
    return Math.ceil((deficit / this.refillPerSecond) * 1000);
  }

  get availableTokens(): number {
    return this.#tokens;
  }
}

/**
 * Circuit breaker.
 *
 * Closed → Open after `threshold` consecutive failures. Open → HalfOpen after
 * `resetMs`. A single success in HalfOpen closes it; a failure re-opens.
 */
export class CircuitBreaker {
  #failures = 0;
  #openedAt: number | null = null;

  constructor(
    readonly provider: string,
    private readonly threshold = 5,
    private readonly resetMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.#openedAt === null) return 'closed';
    return this.now() - this.#openedAt >= this.resetMs ? 'half-open' : 'open';
  }

  assertClosed(): void {
    if (this.state === 'open') {
      throw new CircuitOpenError(this.provider, new Date((this.#openedAt ?? 0) + this.resetMs));
    }
  }

  recordSuccess(): void {
    this.#failures = 0;
    this.#openedAt = null;
  }

  recordFailure(): void {
    this.#failures += 1;
    if (this.#failures >= this.threshold) {
      this.#openedAt = this.now();
    }
  }
}

export interface HttpClientOptions {
  readonly provider: string;
  readonly retry?: RetryPolicy;
  readonly rateLimiter?: RateLimiter;
  readonly circuitBreaker?: CircuitBreaker;
  /** Called on 401. Return a fresh access token, or null to give up. */
  readonly onAuthFailure?: () => Promise<string | null>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly accessToken?: string;
  readonly signal?: AbortSignal;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
  /** Attempts made, including the successful one. Surfaced for observability. */
  readonly attempts: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class HttpClient {
  readonly #opts: HttpClientOptions;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: HttpClientOptions) {
    this.#opts = opts;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#sleep = opts.sleep ?? defaultSleep;
  }

  async request(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const retry = this.#opts.retry ?? DEFAULT_RETRY;
    const breaker = this.#opts.circuitBreaker;

    let token = options.accessToken;
    let refreshed = false;
    let lastError: unknown;

    for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
      breaker?.assertClosed();

      // Self-limit before spending a provider request.
      const wait = this.#opts.rateLimiter?.reserve() ?? 0;
      if (wait > 0) await this.#sleep(wait);

      try {
        const response = await this.#fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers,
          },
          ...(options.body !== undefined ? { body: options.body } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });

        const body = await response.text();

        if (response.ok) {
          breaker?.recordSuccess();
          return { status: response.status, body, headers: response.headers, attempts: attempt + 1 };
        }

        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const error = new HttpError(response.status, body, url, retryAfter);

        // A 401 usually means the access token expired mid-backfill. Refresh once
        // and retry; a second 401 is a real authorization problem and should
        // surface as reauth_required rather than being retried into the ground.
        if (error.isAuthFailure && !refreshed && this.#opts.onAuthFailure) {
          const fresh = await this.#opts.onAuthFailure();
          refreshed = true;
          if (fresh) {
            token = fresh;
            continue;
          }
        }

        if (!error.isRetryable) {
          breaker?.recordFailure();
          throw error;
        }

        lastError = error;
        breaker?.recordFailure();

        if (attempt < retry.maxAttempts - 1) {
          // Honour Retry-After when the provider gives one; it knows better than
          // our backoff curve does.
          await this.#sleep(retryAfter ?? backoffDelay(attempt, retry));
        }
      } catch (err) {
        if (err instanceof HttpError && !err.isRetryable) throw err;
        if (err instanceof CircuitOpenError) throw err;

        lastError = err;
        breaker?.recordFailure();
        if (attempt < retry.maxAttempts - 1) {
          await this.#sleep(backoffDelay(attempt, retry));
        }
      }
    }

    // `lastError` is unknown-typed; rethrow real errors as-is so callers can
    // still switch on HttpError, and wrap anything else rather than throwing a
    // non-Error value.
    if (lastError instanceof Error) throw lastError;
    throw new Error(`Request to ${url} failed after ${retry.maxAttempts} attempts`, {
      cause: lastError,
    });
  }

  async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.request(url, options);
    return JSON.parse(response.body) as T;
  }
}
