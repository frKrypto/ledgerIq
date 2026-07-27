import { and, eq } from 'drizzle-orm';
import {
  decrypt,
  encrypt,
  generateDataKey,
  unwrapDataKey,
  type DataKey,
  type KmsProvider,
} from '@ledgeriq/crypto';
import type { TenantDb } from '../tenant-context.js';
import { connections, tenantDataKeys } from '../schema/index.js';

/**
 * Credential vault.
 *
 * Connector credentials are the highest-value data we hold — higher than the
 * financial records themselves, because they grant access to systems we don't
 * control. This is the only place they are read or written.
 *
 * Envelope encryption per docs/03-engineering/security.md §4: a per-tenant DEK,
 * itself stored wrapped under a KMS root key. Two consequences that are tested
 * rather than asserted:
 *   - A database dump yields no usable tokens.
 *   - One compromised DEK exposes one tenant, not the fleet.
 */

export interface StoredCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly externalAccountId?: string;
}

/**
 * Fetch or lazily create this tenant's current data key.
 *
 * The unwrapped key is never persisted and should not be cached beyond the
 * lifetime of a request. A short-TTL in-memory cache is a reasonable optimisation
 * later — a KMS call per credential read is slow and expensive at fleet scale —
 * but it must be keyed by orgId and bounded, or it becomes a way for one tenant's
 * key to outlive its scope.
 */
export async function getOrCreateDataKey(
  db: TenantDb,
  kms: KmsProvider,
): Promise<DataKey> {
  const [existing] = await db
    .select()
    .from(tenantDataKeys)
    .where(eq(tenantDataKeys.isCurrent, true))
    .limit(1);

  if (existing) {
    return unwrapDataKey(kms, {
      orgId: existing.orgId,
      version: existing.version,
      wrappedKey: Buffer.from(existing.wrappedKey, 'base64'),
      kmsKeyId: existing.kmsKeyId,
    });
  }

  const { key, wrapped } = await generateDataKey(kms, db.orgId);
  await db.insert(tenantDataKeys).values({
    orgId: db.orgId,
    wrappedKey: wrapped.wrappedKey.toString('base64'),
    kmsKeyId: wrapped.kmsKeyId,
    version: wrapped.version,
    isCurrent: true,
  });
  return key;
}

export async function storeCredentials(
  db: TenantDb,
  kms: KmsProvider,
  connectionId: string,
  credentials: StoredCredentials,
): Promise<void> {
  const key = await getOrCreateDataKey(db, kms);
  const sealed = encrypt(key, JSON.stringify(credentials));

  await db
    .update(connections)
    .set({
      credentialsEncrypted: sealed.toString('base64'),
      credentialsKeyId: `${key.orgId}:v${key.version}`,
    })
    .where(eq(connections.id, connectionId));
}

export async function readCredentials(
  db: TenantDb,
  kms: KmsProvider,
  connectionId: string,
): Promise<StoredCredentials | null> {
  const [row] = await db
    .select({ sealed: connections.credentialsEncrypted })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);

  if (!row?.sealed) return null;

  const key = await getOrCreateDataKey(db, kms);
  // orgId is bound as AAD, so a credentials row copied between tenants fails to
  // decrypt rather than silently yielding another tenant's token.
  return JSON.parse(decrypt(key, Buffer.from(row.sealed, 'base64'))) as StoredCredentials;
}

/**
 * Persist rotated credentials.
 *
 * QuickBooks invalidates the previous refresh token the instant a new one is
 * issued, so this must complete durably before the new access token is used. A
 * crash between refresh and save strands the connection and forces the customer
 * to reconnect — a support ticket that looks like our bug, because it is.
 */
export async function rotateCredentials(
  db: TenantDb,
  kms: KmsProvider,
  connectionId: string,
  next: StoredCredentials,
): Promise<void> {
  await storeCredentials(db, kms, connectionId, next);
  await db
    .update(connections)
    .set({ status: 'active', statusDetail: null, consecutiveFailures: 0 })
    .where(eq(connections.id, connectionId));
}

export async function markReauthRequired(
  db: TenantDb,
  connectionId: string,
  reason: string,
): Promise<void> {
  await db
    .update(connections)
    .set({ status: 'reauth_required', statusDetail: reason })
    .where(and(eq(connections.id, connectionId)));
}
