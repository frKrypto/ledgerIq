import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import type { KmsProvider } from './kms.js';

/**
 * Per-tenant envelope encryption for connector credentials.
 *
 * Threat being addressed: an attacker obtains a database dump. Without envelope
 * encryption they now hold OAuth tokens for every customer's QuickBooks and bank
 * accounts — a far worse outcome than the loss of our own data, because it grants
 * access to systems we don't control.
 *
 * Structure (docs/03-engineering/security.md §4):
 *
 *   KMS root key (never leaves the KMS)
 *        └── per-tenant Data Encryption Key, stored WRAPPED
 *                 └── encrypts that tenant's credentials
 *
 * Two properties follow, and both are tested:
 *   - A database dump alone is useless: DEKs are only ever stored wrapped.
 *   - One compromised DEK exposes ONE tenant, not the fleet.
 *
 * AES-256-GCM specifically, because it is authenticated: a tampered ciphertext
 * fails to decrypt rather than silently yielding corrupted plaintext. For
 * credentials that distinction matters — a silently mangled refresh token would
 * present as a mysterious auth failure rather than as the tampering it is.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;
const VERSION = 1;

export class CryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CryptoError';
  }
}

/** A tenant's data key, unwrapped and ready to use. Never persisted in this form. */
export interface DataKey {
  readonly orgId: string;
  readonly version: number;
  readonly material: Buffer;
}

/** A wrapped data key, safe to store. */
export interface WrappedDataKey {
  readonly orgId: string;
  readonly version: number;
  readonly wrappedKey: Buffer;
  readonly kmsKeyId: string;
}

/**
 * Serialized ciphertext layout:
 *
 *   [ 1 byte version | 1 byte keyVersion | 12 byte IV | 16 byte tag | ciphertext ]
 *
 * Self-describing so a future algorithm or key rotation can be handled without
 * a migration of stored values: the reader learns which key version to unwrap
 * from the payload itself.
 */
export function serialize(parts: {
  keyVersion: number;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}): Buffer {
  if (parts.keyVersion < 0 || parts.keyVersion > 255) {
    throw new CryptoError(`Key version ${parts.keyVersion} does not fit in one byte`);
  }
  return Buffer.concat([
    Buffer.from([VERSION, parts.keyVersion]),
    parts.iv,
    parts.tag,
    parts.ciphertext,
  ]);
}

export function deserialize(blob: Buffer): {
  keyVersion: number;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
} {
  const HEADER = 2 + IV_BYTES + TAG_BYTES;
  if (blob.length < HEADER) {
    throw new CryptoError('Ciphertext is too short to be well-formed');
  }
  const version = blob[0];
  if (version !== VERSION) {
    throw new CryptoError(`Unsupported ciphertext version ${String(version)}`);
  }
  return {
    keyVersion: blob[1] as number,
    iv: blob.subarray(2, 2 + IV_BYTES),
    tag: blob.subarray(2 + IV_BYTES, HEADER),
    ciphertext: blob.subarray(HEADER),
  };
}

/**
 * Encrypt a credential for one tenant.
 *
 * `orgId` is bound as Additional Authenticated Data. This is the subtle and
 * important part: AAD is authenticated but not encrypted, so a ciphertext
 * created for tenant A will FAIL to decrypt under tenant B's context even if an
 * attacker (or a bug) copies the row across tenants. Without AAD, a
 * cross-tenant row copy would decrypt cleanly wherever the key was available.
 */
export function encrypt(key: DataKey, plaintext: string): Buffer {
  if (key.material.length !== KEY_BYTES) {
    throw new CryptoError(`Data key must be ${KEY_BYTES} bytes, got ${key.material.length}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key.material, iv);
  cipher.setAAD(Buffer.from(key.orgId, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return serialize({ keyVersion: key.version, iv, tag: cipher.getAuthTag(), ciphertext });
}

export function decrypt(key: DataKey, blob: Buffer): string {
  const { keyVersion, iv, tag, ciphertext } = deserialize(blob);

  if (keyVersion !== key.version) {
    throw new CryptoError(
      `Ciphertext was sealed with key version ${keyVersion}, but version ${key.version} was supplied`,
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key.material, iv);
  decipher.setAAD(Buffer.from(key.orgId, 'utf8'));
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (cause) {
    // GCM authentication failed: wrong key, wrong tenant, or tampering. All three
    // are security events and none should be distinguishable to a caller.
    throw new CryptoError('Decryption failed: ciphertext is not authentic for this key/tenant', {
      cause,
    });
  }
}

/** Generate a fresh DEK and wrap it under the KMS root key. */
export async function generateDataKey(
  kms: KmsProvider,
  orgId: string,
  version = 1,
): Promise<{ key: DataKey; wrapped: WrappedDataKey }> {
  const material = randomBytes(KEY_BYTES);
  const wrappedKey = await kms.wrap(material, orgId);
  return {
    key: { orgId, version, material },
    wrapped: { orgId, version, wrappedKey, kmsKeyId: kms.keyId },
  };
}

export async function unwrapDataKey(
  kms: KmsProvider,
  wrapped: WrappedDataKey,
): Promise<DataKey> {
  const material = await kms.unwrap(wrapped.wrappedKey, wrapped.orgId);
  if (material.length !== KEY_BYTES) {
    throw new CryptoError('Unwrapped data key has unexpected length');
  }
  return { orgId: wrapped.orgId, version: wrapped.version, material };
}

/** Constant-time comparison, for anywhere a secret is checked against input. */
export function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // Length is not secret, but bail before timingSafeEqual, which throws on
  // mismatched lengths.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Redact a credential for logging.
 *
 * Every log line that might touch a token should go through this. The rule from
 * compliance.md §6 — no financial data or credentials in logs — decays silently
 * unless there is an obvious right way to do it.
 */
export function redact(secret: string): string {
  if (secret.length <= 8) return '***';
  return `${secret.slice(0, 4)}…${secret.slice(-4)} (${secret.length} chars)`;
}
