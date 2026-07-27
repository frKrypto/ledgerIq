import { pgEnum } from 'drizzle-orm/pg-core';

export const businessModel = pgEnum('business_model', [
  'services', 'subscription', 'ecommerce', 'retail', 'mixed', 'unknown',
]);

export const memberRole = pgEnum('member_role', [
  'owner', 'admin', 'finance', 'viewer', 'advisor',
]);

export const sourceSystem = pgEnum('source_system', [
  'quickbooks', 'xero', 'plaid', 'stripe', 'square', 'paypal', 'gusto',
  'shopify', 'amazon_seller', 'brex', 'ramp', 'mercury', 'hubspot',
  'salesforce', 'manual', 'csv',
]);

export const sourceType = pgEnum('source_type', [
  'accounting', 'banking', 'payments', 'payroll', 'commerce', 'crm', 'spend',
]);

export const connectionStatus = pgEnum('connection_status', [
  'active', 'degraded', 'reauth_required', 'error', 'disconnected',
]);

export const syncStatus = pgEnum('sync_status', [
  'queued', 'running', 'succeeded', 'partial', 'failed',
]);
