import {
  bigserial,
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
] as const;

/**
 * Tables deliberately NOT tenant-scoped, with the reason. Anything not in either
 * list is an oversight, and the tenancy suite treats it as a failure.
 */
export const GLOBAL_TABLES: Record<string, string> = {
  users: 'A user may belong to several orgs; access is mediated by memberships.',
  firms: 'A firm spans many orgs; access is mediated by firm_clients.',
  schema_migrations: 'Migration bookkeeping, no tenant data.',
};
