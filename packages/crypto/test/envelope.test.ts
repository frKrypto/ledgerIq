import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  CryptoError,
  decrypt,
  deserialize,
  encrypt,
  generateDataKey,
  redact,
  secureEquals,
  unwrapDataKey,
} from '../src/envelope.js';
import { LocalKms } from '../src/kms.js';

/**
 * Envelope encryption tests.
 *
 * The properties under test are the ones the threat model actually depends on
 * (docs/03-engineering/security.md §1, threat #3):
 *
 *   - A database dump is useless without KMS access
 *   - One compromised tenant key exposes ONE tenant
 *   - Tampering is detected rather than silently yielding garbage
 *
 * Each is asserted directly rather than inferred from "we used AES".
 */

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const TOKEN = 'qbo_refresh_AB12cd34EF56gh78IJ90kl';

describe('round trip', () => {
  it('encrypts and decrypts a credential', async () => {
    const kms = new LocalKms();
    const { key } = await generateDataKey(kms, ORG_A);

    const sealed = encrypt(key, TOKEN);
    expect(decrypt(key, sealed)).toBe(TOKEN);
  });

  it('produces different ciphertext each time for the same plaintext', async () => {
    // A deterministic ciphertext would leak that two tenants hold the same
    // credential, and would be catastrophic under GCM (nonce reuse breaks the
    // cipher outright).
    const kms = new LocalKms();
    const { key } = await generateDataKey(kms, ORG_A);

    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(encrypt(key, TOKEN).toString('base64'));
    }
    expect(seen.size).toBe(200);
  });

  it('never emits a nonce twice across many encryptions', async () => {
    const kms = new LocalKms();
    const { key } = await generateDataKey(kms, ORG_A);

    const nonces = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      nonces.add(deserialize(encrypt(key, TOKEN)).iv.toString('hex'));
    }
    expect(nonces.size).toBe(5000);
  });

  it('handles empty, unicode, and long plaintext', async () => {
    const kms = new LocalKms();
    const { key } = await generateDataKey(kms, ORG_A);

    for (const value of ['', '🔐 café — naïve', 'x'.repeat(100_000)]) {
      expect(decrypt(key, encrypt(key, value))).toBe(value);
    }
  });
});

describe('tenant isolation — the property that matters most', () => {
  it("a ciphertext sealed for one tenant will not decrypt under another tenant's context", async () => {
    // The realistic failure: a bug or an attacker copies a credentials row from
    // tenant A to tenant B. Binding orgId as AAD means the copied row is inert.
    const kms = new LocalKms();
    const { key: keyA } = await generateDataKey(kms, ORG_A);
    const sealed = encrypt(keyA, TOKEN);

    // Same key material, but presented under the wrong tenant identity.
    const impersonated = { ...keyA, orgId: ORG_B };
    expect(() => decrypt(impersonated, sealed)).toThrow(CryptoError);
  });

  it("one tenant's key cannot decrypt another tenant's credential", async () => {
    const kms = new LocalKms();
    const { key: keyA } = await generateDataKey(kms, ORG_A);
    const { key: keyB } = await generateDataKey(kms, ORG_B);

    const sealedForA = encrypt(keyA, TOKEN);
    expect(() => decrypt(keyB, sealedForA)).toThrow(CryptoError);
  });

  it('a wrapped key for one tenant cannot be unwrapped as another', async () => {
    const kms = new LocalKms();
    const { wrapped } = await generateDataKey(kms, ORG_A);

    await expect(unwrapDataKey(kms, { ...wrapped, orgId: ORG_B })).rejects.toThrow();
  });
});

describe('a database dump is not enough', () => {
  it('the stored key is wrapped, and the plaintext key never appears in it', async () => {
    const kms = new LocalKms();
    const { key, wrapped } = await generateDataKey(kms, ORG_A);

    // What lands in tenant_data_keys.wrapped_key must not contain the DEK.
    expect(wrapped.wrappedKey.includes(key.material)).toBe(false);
    expect(wrapped.wrappedKey.equals(key.material)).toBe(false);
  });

  it('credentials cannot be recovered from stored bytes without the KMS root key', async () => {
    const kms = new LocalKms('the-real-root-key');
    const { key, wrapped } = await generateDataKey(kms, ORG_A);
    const sealedCredential = encrypt(key, TOKEN);

    // An attacker holds both database columns but not the KMS root key.
    const attackerKms = new LocalKms('a-different-root-key');
    await expect(unwrapDataKey(attackerKms, wrapped)).rejects.toThrow();

    // And the credential ciphertext itself reveals nothing.
    expect(sealedCredential.toString('utf8')).not.toContain(TOKEN);
    expect(sealedCredential.toString('base64')).not.toContain(TOKEN);
  });
});

describe('tampering is detected, not absorbed', () => {
  it('rejects a flipped bit anywhere in the ciphertext', async () => {
    const kms = new LocalKms();
    const { key } = await generateDataKey(kms, ORG_A);
    const sealed = encrypt(key, TOKEN);

    // Every byte position, not a sampled one: a gap in authentication coverage
    // would show up as one position that decrypts happily.
    for (let i = 0; i < sealed.length; i++) {
      const tampered = Buffer.from(sealed);
      tampered[i] = (tampered[i] as number) ^ 0x01;
      expect(() => decrypt(key, tampered), `byte ${i} was not authenticated`).toThrow();
    }
  });

  it('rejects truncated ciphertext', async () => {
    const kms = new LocalKms();
    const { key } = await generateDataKey(kms, ORG_A);
    const sealed = encrypt(key, TOKEN);

    expect(() => decrypt(key, sealed.subarray(0, 10))).toThrow(CryptoError);
    expect(() => decrypt(key, Buffer.alloc(0))).toThrow(CryptoError);
  });

  it('rejects an unknown ciphertext version', async () => {
    const kms = new LocalKms();
    const { key } = await generateDataKey(kms, ORG_A);
    const sealed = encrypt(key, TOKEN);
    sealed[0] = 99;

    expect(() => decrypt(key, sealed)).toThrow(/version/i);
  });
});

describe('key rotation', () => {
  it('refuses to decrypt with a key version the ciphertext was not sealed under', async () => {
    const kms = new LocalKms();
    const { key: v1 } = await generateDataKey(kms, ORG_A, 1);
    const sealed = encrypt(v1, TOKEN);

    const v2 = { ...v1, version: 2, material: randomBytes(32) };
    expect(() => decrypt(v2, sealed)).toThrow(/version/i);
  });

  it('records the key version in the ciphertext so old values stay readable', async () => {
    // Rotation must not require re-encrypting every stored credential; the reader
    // learns which key to unwrap from the payload itself.
    const kms = new LocalKms();
    const { key: v1 } = await generateDataKey(kms, ORG_A, 1);
    const { key: v2raw } = await generateDataKey(kms, ORG_A, 2);

    const oldSealed = encrypt(v1, 'old-token');
    const newSealed = encrypt(v2raw, 'new-token');

    expect(deserialize(oldSealed).keyVersion).toBe(1);
    expect(deserialize(newSealed).keyVersion).toBe(2);
    expect(decrypt(v1, oldSealed)).toBe('old-token');
    expect(decrypt(v2raw, newSealed)).toBe('new-token');
  });
});

describe('operational helpers', () => {
  it('secureEquals matches and rejects without leaking length via throw', () => {
    expect(secureEquals('abc123', 'abc123')).toBe(true);
    expect(secureEquals('abc123', 'abc124')).toBe(false);
    expect(secureEquals('short', 'much longer value')).toBe(false);
  });

  it('redact never reveals the middle of a secret', () => {
    const out = redact(TOKEN);
    expect(out).not.toContain('cd34EF56gh78IJ90');
    expect(out).toContain('qbo_');
    expect(redact('tiny')).toBe('***');
  });
});

describe('LocalKms guards', () => {
  it('refuses to construct under NODE_ENV=production', () => {
    const previous = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      expect(() => new LocalKms()).toThrow(/never be used in production/);
    } finally {
      if (previous === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previous;
    }
  });
});
