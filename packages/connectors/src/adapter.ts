/**
 * The connector adapter interface.
 *
 * This is what makes "three connectors now, more later" a safe strategy
 * (docs/03-engineering/integrations.md §6). Everything downstream of `normalize`
 * is source-agnostic, so adding a connector touches exactly one directory and
 * adds zero conditionals to the metric engine.
 *
 * If source-specific branching ever leaks into business logic, that is a design
 * regression worth stopping to fix — it is how integration strategies become
 * unmaintainable, one reasonable-looking `if (source === 'stripe')` at a time.
 */

export type SourceSystem =
  | 'quickbooks' | 'xero' | 'plaid' | 'stripe' | 'square' | 'paypal' | 'gusto'
  | 'shopify' | 'amazon_seller' | 'brex' | 'ramp' | 'mercury' | 'hubspot'
  | 'salesforce' | 'manual' | 'csv';

export type SourceType =
  | 'accounting' | 'banking' | 'payments' | 'payroll' | 'commerce' | 'crm' | 'spend';

export interface ConnectionCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  /** Provider-specific account identifier — QuickBooks realmId, Plaid item_id. */
  readonly externalAccountId?: string;
}

export interface ConnectionRef {
  readonly id: string;
  readonly orgId: string;
  readonly source: SourceSystem;
  readonly credentials: ConnectionCredentials;
  readonly externalAccountId?: string;
}

/** A page of provider data, exactly as returned, before any interpretation. */
export interface RawBatch {
  readonly recordType: string;
  readonly records: unknown[];
  /** The untouched response body, for the archive. */
  readonly rawResponse: unknown;
  readonly pageIndex: number;
  readonly hasMore: boolean;
  /** Opaque resume state. Persisted so an interrupted sync continues here. */
  readonly cursor: Record<string, unknown>;
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
}

export interface SyncOptions {
  /** Earliest data to fetch. Backfill default is 24 months. */
  readonly since?: Date;
  /** Resume state from a previous interrupted run. */
  readonly checkpoint?: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

export type ConnectionHealth =
  | { readonly status: 'healthy' }
  | { readonly status: 'degraded'; readonly reason: string }
  | { readonly status: 'reauth_required'; readonly reason: string }
  | { readonly status: 'error'; readonly reason: string };

/**
 * Reconciliation: our totals against the provider's own reported totals.
 *
 * This is what catches the failure mode health checks miss — an API returning
 * 200 with subtly incomplete data. Silent under-fetching produces confidently
 * wrong metrics with no error anywhere, and it is the connector failure that
 * actually hurts.
 */
export interface ReconciliationReport {
  readonly recordType: string;
  readonly ourCount: number;
  readonly providerCount: number | null;
  readonly divergent: boolean;
}

export interface ConnectorAdapter {
  readonly source: SourceSystem;
  readonly kind: SourceType;
  /** Record types this adapter syncs, in dependency order. */
  readonly recordTypes: readonly string[];

  /** Exchange an authorization code for durable credentials. */
  authorize(params: { code: string; redirectUri: string; realmId?: string }): Promise<ConnectionCredentials>;

  refresh(credentials: ConnectionCredentials): Promise<ConnectionCredentials>;

  /** Historical backfill. Resumable via `options.checkpoint`. */
  fullSync(connection: ConnectionRef, recordType: string, options?: SyncOptions): AsyncIterable<RawBatch>;

  /** Delta sync from a stored cursor. */
  incrementalSync(connection: ConnectionRef, recordType: string, cursor: Record<string, unknown>): AsyncIterable<RawBatch>;

  healthCheck(connection: ConnectionRef): Promise<ConnectionHealth>;

  reconcile(connection: ConnectionRef, recordType: string, ourCount: number): Promise<ReconciliationReport>;
}
