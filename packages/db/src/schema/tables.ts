import {
  bigserial,
  date,
  numeric,
  pgEnum,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  businessModel,
  connectionStatus,
  memberRole,
  sourceSystem,
  sourceType,
  syncStatus,
} from './enums.js';

/**
 * Drizzle definitions mirroring migrations/0001_core.sql.
 *
 * The SQL migrations are the source of truth — RLS policies, partial indexes,
 * and grants have no Drizzle representation, and hand-written DDL keeps them
 * reviewable. These definitions exist for typed queries, and the schema-drift
 * test asserts the two stay in agreement.
 */

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id'),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  businessModel: businessModel('business_model').notNull().default('unknown'),
  naicsCode: text('naics_code'),
  revenueBand: text('revenue_band'),
  employeeCount: integer('employee_count'),
  country: char('country', { length: 2 }).notNull().default('US'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('USD'),
  fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(1),
  timezone: text('timezone').notNull().default('America/New_York'),
  accountingBasis: text('accounting_basis').notNull().default('accrual'),
  onboardingStage: text('onboarding_stage').notNull().default('created'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  planTier: text('plan_tier').notNull().default('trial'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalAuthId: text('external_auth_id').notNull().unique(),
  email: text('email').notNull().unique(),
  fullName: text('full_name'),
  mfaEnrolled: boolean('mfa_enrolled').notNull().default(false),
  financialLiteracy: text('financial_literacy').notNull().default('standard'),
  locale: text('locale').notNull().default('en-US'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('viewer'),
    restrictions: jsonb('restrictions').notNull().default({}),
    invitedBy: uuid('invited_by').references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('memberships_org_user_key').on(t.orgId, t.userId)],
);

export const firms = pgTable('firms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  planTier: text('plan_tier').notNull().default('firm_starter'),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const firmClients = pgTable(
  'firm_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    grantedBy: uuid('granted_by').references(() => users.id),
    accessLevel: text('access_level').notNull().default('advisor'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('firm_clients_firm_org_key').on(t.firmId, t.orgId)],
);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: text('scopes').array().notNull().default(sql`'{}'`),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    source: sourceSystem('source').notNull(),
    sourceKind: sourceType('source_kind').notNull(),
    externalAccountId: text('external_account_id'),
    displayName: text('display_name'),
    status: connectionStatus('status').notNull().default('active'),
    statusDetail: text('status_detail'),
    /** Sealed with a per-tenant data key. Never readable through the API. */
    credentialsEncrypted: text('credentials_encrypted'),
    credentialsKeyId: text('credentials_key_id'),
    scopesGranted: text('scopes_granted').array(),
    connectedBy: uuid('connected_by').references(() => users.id),
    /** Drives the user-visible data-freshness indicator on every surface. */
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true }),
    syncCursor: text('sync_cursor'),
    backfillCompletedAt: timestamp('backfill_completed_at', { withTimezone: true }),
    // Added in 0004_ingestion.sql for the backfill orchestrator.
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    realmId: text('realm_id'),
    backfillStartedAt: timestamp('backfill_started_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  },
  (t) => [index('connections_org_idx').on(t.orgId, t.source)],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: syncStatus('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    recordsFetched: integer('records_fetched').notNull().default(0),
    recordsWritten: integer('records_written').notNull().default(0),
    recordsSkipped: integer('records_skipped').notNull().default(0),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    reconciliation: jsonb('reconciliation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sync_runs_recent_idx').on(t.orgId, t.connectionId, t.createdAt)],
);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorType: text('actor_type').notNull().default('user'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dataAccessLog = pgTable('data_access_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorType: text('actor_type').notNull().default('user'),
  firmId: uuid('firm_id').references(() => firms.id),
  resourceType: text('resource_type').notNull(),
  scope: jsonb('scope'),
  accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
});


export const rawPayloads = pgTable(
  'raw_payloads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    syncRunId: uuid('sync_run_id').references(() => syncRuns.id, { onDelete: 'set null' }),
    objectKey: text('object_key').notNull(),
    /** sha256 over the semantic records, not the provider envelope. */
    contentHash: text('content_hash').notNull(),
    byteSize: integer('byte_size').notNull(),
    recordType: text('record_type').notNull(),
    recordCount: integer('record_count').notNull().default(0),
    pageIndex: integer('page_index'),
    windowStart: date('window_start'),
    windowEnd: date('window_end'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('raw_payloads_lookup').on(t.orgId, t.connectionId, t.recordType)],
);

export const syncCheckpoints = pgTable(
  'sync_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    recordType: text('record_type').notNull(),
    phase: text('phase').notNull().default('backfill'),
    cursor: jsonb('cursor').notNull().default({}),
    recordsSeen: integer('records_seen').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    attemptCount: integer('attempt_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sync_checkpoints_conn_type_key').on(t.connectionId, t.recordType)],
);

export const tenantDataKeys = pgTable('tenant_data_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  /** DEK ciphertext under the KMS root key. The plaintext key is never stored. */
  wrappedKey: text('wrapped_key').notNull(),
  kmsKeyId: text('kms_key_id').notNull(),
  version: integer('version').notNull().default(1),
  isCurrent: boolean('is_current').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
});


// ── canonical financial model (0005) ────────────────────────────────────────

export const statementClass = pgEnum('statement_class', [
  'revenue','cogs','opex','payroll','other_income','other_expense','asset','liability','equity',
]);
export const txnDirection = pgEnum('txn_direction', ['inflow', 'outflow']);
export const categorySource = pgEnum('category_source', [
  'user_rule','source_system','classifier','llm','default',
]);
export const accountTypeEnum = pgEnum('account_type', [
  'checking','savings','credit_card','loan','line_of_credit','investment','payment_processor','other',
]);
export const docStatus = pgEnum('doc_status', [
  'draft','open','partial','paid','overdue','void','written_off',
]);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id'),
  parentId: uuid('parent_id'),
  key: text('key').notNull(),
  name: text('name').notNull(),
  statement: statementClass('statement').notNull(),
  isDiscretionary: boolean('is_discretionary').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerAccounts = pgTable('ledger_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  source: sourceSystem('source').notNull(),
  sourceAccountId: text('source_account_id').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name'),
  accountType: text('account_type'),
  accountSubtype: text('account_subtype'),
  statement: statementClass('statement'),
  mappingConfidence: numeric('mapping_confidence'),
  needsReview: boolean('needs_review').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  email: text('email'),
  /** Fitted payment-lag distribution — the main forecast-accuracy input. */
  paymentBehavior: jsonb('payment_behavior').notNull().default({}),
  source: sourceSystem('source').notNull(),
  sourceCustomerId: text('source_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  accountId: uuid('account_id'),
  ledgerAccountId: uuid('ledger_account_id'),
  direction: txnDirection('direction').notNull(),
  amount: numeric('amount').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  /** Economic timing (accrual). */
  occurredAt: date('occurred_at').notNull(),
  /** Cash settlement. Null means no cash has moved yet. */
  postedAt: date('posted_at'),
  description: text('description'),
  merchantName: text('merchant_name'),
  categoryId: uuid('category_id'),
  statement: statementClass('statement'),
  categorySource: categorySource('category_source').notNull().default('default'),
  categoryConfidence: numeric('category_confidence'),
  customerId: uuid('customer_id'),
  vendorId: uuid('vendor_id'),
  isCanonical: boolean('is_canonical').notNull().default(true),
  isTransfer: boolean('is_transfer').notNull().default(false),
  source: sourceSystem('source').notNull(),
  sourceTxnId: text('source_txn_id'),
  sourceRecordType: text('source_record_type'),
  transformVersion: text('transform_version').notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  customerId: uuid('customer_id'),
  number: text('number'),
  status: docStatus('status').notNull().default('open'),
  issuedOn: date('issued_on').notNull(),
  dueDate: date('due_date'),
  termsDays: integer('terms_days'),
  total: numeric('total').notNull(),
  amountPaid: numeric('amount_paid').notNull().default('0'),
  paidOn: date('paid_on'),
  expectedPaymentDate: date('expected_payment_date'),
  source: sourceSystem('source').notNull(),
  sourceInvoiceId: text('source_invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
});

export const forecasts = pgTable('forecasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  kind: text('kind').notNull().default('cash'),
  horizonDays: integer('horizon_days').notNull().default(91),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  points: jsonb('points').notNull(),
  riskEvents: jsonb('risk_events').notNull().default([]),
  assumptions: jsonb('assumptions').notNull().default([]),
  methodVersion: text('method_version').notNull(),
  confidence: text('confidence').notNull(),
  historyDays: integer('history_days'),
  /** Re-run of today's engine over a past date. See 0007 for why it is separated. */
  isBackfilled: boolean('is_backfilled').notNull().default(false),
});

/**
 * What actually happened, against what we said would happen.
 *
 * See 0006_forecast_scores.sql for why this table ships before anything with a
 * UI: the history cannot be reconstructed retroactively.
 */
export const forecastScores = pgTable('forecast_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  forecastId: uuid('forecast_id').notNull(),
  horizonDays: integer('horizon_days').notNull(),
  targetDate: date('target_date').notNull(),
  predictedP50: numeric('predicted_p50').notNull(),
  predictedP10: numeric('predicted_p10').notNull(),
  predictedP90: numeric('predicted_p90').notNull(),
  actual: numeric('actual').notNull(),
  signedError: numeric('signed_error').notNull(),
  absPctError: numeric('abs_pct_error').notNull(),
  withinBand: boolean('within_band').notNull(),
  methodVersion: text('method_version').notNull(),
  isBackfilled: boolean('is_backfilled').notNull().default(false),
  scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tables carrying tenant data, each protected by an RLS policy in 0002_rls.sql.
 * The tenancy suite iterates this list, so a new tenant table added without a
 * policy fails CI rather than shipping unprotected.
 */
export const TENANT_SCOPED_TABLES = [
  'organizations',
  'memberships',
  'api_keys',
  'connections',
  'sync_runs',
  'firm_clients',
  'audit_log',
  'data_access_log',
  'raw_payloads',
  'sync_checkpoints',
  'tenant_data_keys',
  'ledger_accounts',
  'accounts',
  'customers',
  'vendors',
  'transactions',
  'invoices',
  'payroll_runs',
  'balances',
  'metric_snapshots',
  'forecasts',
  'forecast_scores',
] as const;

/**
 * Tables deliberately NOT tenant-scoped, with the reason. Anything not in either
 * list is an oversight, and the tenancy suite treats it as a failure.
 */
export const GLOBAL_TABLES: Record<string, string> = {
  users: 'A user may belong to several orgs; access is mediated by memberships.',
  firms: 'A firm spans many orgs; access is mediated by firm_clients.',
  schema_migrations: 'Migration bookkeeping, no tenant data.',
  categories: 'Carries the shared system taxonomy (org_id IS NULL) alongside tenant rows; its RLS policy admits both.',
};
