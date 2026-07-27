import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * KMS abstraction.
 *
 * Production uses AWS KMS: the root key material never leaves the HSM, and
 * wrap/unwrap are API calls. Development and tests use LocalKms, which has the
 * same interface and is deliberately NOT safe for production — it holds root key
 * material in process memory.
 *
 * The interface is narrow on purpose. We only ever need to wrap and unwrap data
 * keys; giving the application broader KMS access would widen the blast radius
 * of a compromised application role for no benefit.
 */
export interface KmsProvider {
  readonly keyId: string;
  /** Encrypt data key material under the root key. `orgId` binds the context. */
  wrap(material: Buffer, orgId: string): Promise<Buffer>;
  unwrap(wrapped: Buffer, orgId: string): Promise<Buffer>;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * In-process KMS for development and tests.
 *
 * NOT FOR PRODUCTION. Root key material lives in memory, so a process dump
 * exposes every tenant's data key — precisely the property real KMS exists to
 * prevent. Guarded at construction so it cannot be reached for by accident.
 */
export class LocalKms implements KmsProvider {
  readonly keyId: string;
  readonly #rootKey: Buffer;

  constructor(rootKeyMaterial?: Buffer | string) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'LocalKms must never be used in production — root key material would live in process memory. ' +
          'Use AwsKms.',
      );
    }
    this.#rootKey =
      typeof rootKeyMaterial === 'string'
        ? createHash('sha256').update(rootKeyMaterial).digest()
        : (rootKeyMaterial ?? randomBytes(32));

    if (this.#rootKey.length !== 32) {
      throw new Error('Root key must be 32 bytes');
    }
    this.keyId = `local:${createHash('sha256').update(this.#rootKey).digest('hex').slice(0, 16)}`;
  }

  wrap(material: Buffer, orgId: string): Promise<Buffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#rootKey, iv);
    // Encryption context: a wrapped key for org A cannot be unwrapped as org B.
    // AWS KMS offers the same guarantee via EncryptionContext, so the security
    // property is identical across implementations rather than an artefact of
    // the local one.
    cipher.setAAD(Buffer.from(orgId, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(material), cipher.final()]);
    return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
  }

  unwrap(wrapped: Buffer, orgId: string): Promise<Buffer> {
    const iv = wrapped.subarray(0, IV_BYTES);
    const tag = wrapped.subarray(IV_BYTES, IV_BYTES + 16);
    const ciphertext = wrapped.subarray(IV_BYTES + 16);

    const decipher = createDecipheriv(ALGORITHM, this.#rootKey, iv);
    decipher.setAAD(Buffer.from(orgId, 'utf8'));
    decipher.setAuthTag(tag);
    return Promise.resolve(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  }
}

/**
 * AWS KMS provider — production.
 *
 * Left as an explicit stub rather than a half-implementation: it needs the AWS
 * SDK and real credentials, and a plausible-looking but untested crypto path is
 * worse than an obvious gap. Wired up in the sprint that provisions KMS
 * (infra/modules/secrets).
 *
 * Implementation notes for whoever does it:
 *   - GenerateDataKey / Decrypt with EncryptionContext = { orgId }
 *   - Cache unwrapped DEKs in memory with a short TTL; a KMS call per credential
 *     read is both slow and expensive at fleet scale
 *   - Never log the plaintext data key, including in error paths
 */
export class AwsKms implements KmsProvider {
  constructor(readonly keyId: string) {}

  wrap(_material: Buffer, _orgId: string): Promise<Buffer> {
    return Promise.reject(new Error('AwsKms is not implemented yet — see infra/modules/secrets'));
  }

  unwrap(_wrapped: Buffer, _orgId: string): Promise<Buffer> {
    return Promise.reject(new Error('AwsKms is not implemented yet — see infra/modules/secrets'));
  }
}
