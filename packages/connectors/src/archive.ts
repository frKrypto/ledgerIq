import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Raw payload archive.
 *
 * Stores exactly what the provider returned, immutably, before any of our code
 * interprets it. This is the highest-leverage thing in the ingestion pipeline and
 * the easiest to skip.
 *
 * Why it earns its cost:
 *
 *   Replay      When a normalization bug is found — and one will be — we reprocess
 *               from the archive rather than re-fetching. QuickBooks does not
 *               guarantee historical stability, and deleted records simply
 *               disappear, so "just sync again" can silently lose data.
 *   Recovery    Given raw payloads the entire canonical store is rebuildable. That
 *               changes the risk calculus on normalization bugs from permanent to
 *               recoverable.
 *   Disputes    "Your revenue number is wrong" is answerable by pointing at what
 *               the source actually returned, on a given date.
 *   Audit       7-year retention with S3 Object Lock, per the data lifecycle in
 *               docs/03-engineering/security.md §10.
 */

export interface ArchivedPayload {
  readonly objectKey: string;
  readonly contentHash: string;
  readonly byteSize: number;
}

export interface ArchiveWriteRequest {
  readonly orgId: string;
  readonly connectionId: string;
  readonly recordType: string;
  /** Stored verbatim — the full provider response, untouched. */
  readonly payload: unknown;
  /**
   * The semantically meaningful subset to hash for deduplication. Defaults to
   * the whole payload.
   *
   * This exists because provider responses carry volatile envelope fields.
   * QuickBooks stamps every response with `time`, so re-fetching an identical
   * page yields different bytes and therefore a different hash — which silently
   * defeats deduplication exactly when it is needed, on the retry path after a
   * crash. Caught by the resumption test, which saw 8 "unique" pages where the
   * data contained 6.
   *
   * Hash the records; store the envelope.
   */
  readonly contentForHash?: unknown;
  readonly fetchedAt?: Date;
  readonly pageIndex?: number;
}

export interface RawPayloadArchive {
  put(request: ArchiveWriteRequest): Promise<ArchivedPayload>;
  get(objectKey: string): Promise<unknown>;
}

/**
 * Key layout: org/connection/recordType/YYYY/MM/DD/hash.json.gz
 *
 * Partitioned by tenant first so a per-tenant deletion (account closure, GDPR-
 * style request) is a prefix delete rather than a scan, and date-partitioned so
 * lifecycle rules and targeted replay both work on prefixes.
 */
export function buildObjectKey(req: ArchiveWriteRequest, contentHash: string): string {
  const at = req.fetchedAt ?? new Date();
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(at.getUTCDate()).padStart(2, '0');
  return [
    req.orgId,
    req.connectionId,
    req.recordType,
    String(yyyy),
    mm,
    dd,
    `${contentHash.slice(0, 32)}.json.gz`,
  ].join('/');
}

export function hashPayload(serialized: Buffer): string {
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Serialize deterministically.
 *
 * Object key order in JSON is not guaranteed across fetches, so a naive
 * JSON.stringify would produce different hashes for identical data — defeating
 * both deduplication and corruption detection. Sorting keys makes the hash a
 * property of the content rather than of the serializer's mood.
 */
export function canonicalJson(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sortKeys(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sortKeys(value));
}

/** Local filesystem archive, for development and tests. */
export class FileSystemArchive implements RawPayloadArchive {
  constructor(private readonly rootDir: string) {}

  async put(request: ArchiveWriteRequest): Promise<ArchivedPayload> {
    const serialized = Buffer.from(canonicalJson(request.payload), 'utf8');
    // Hash the semantic content, store the full envelope. See contentForHash.
    const contentHash = hashPayload(
      request.contentForHash === undefined
        ? serialized
        : Buffer.from(canonicalJson(request.contentForHash), 'utf8'),
    );
    const objectKey = buildObjectKey(request, contentHash);
    const compressed = gzipSync(serialized);

    const path = join(this.rootDir, objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, compressed);

    return { objectKey, contentHash, byteSize: compressed.byteLength };
  }

  async get(objectKey: string): Promise<unknown> {
    const raw = await readFile(join(this.rootDir, objectKey));
    return JSON.parse(gunzipSync(raw).toString('utf8'));
  }
}

/**
 * S3 archive — production.
 *
 * Deliberately a stub rather than an untested implementation. Requirements for
 * whoever wires it up (infra/modules/storage):
 *   - Object Lock in COMPLIANCE mode, 7-year retention. Compliance mode means
 *     even root cannot delete early, which is the point of an audit archive.
 *   - SSE-KMS with the per-environment key
 *   - Versioning on; lifecycle transition to Glacier after 90 days
 *   - Bucket policy denying s3:DeleteObject to the application role
 */
export class S3Archive implements RawPayloadArchive {
  constructor(
    private readonly bucket: string,
    private readonly _client?: unknown,
  ) {}

  put(_request: ArchiveWriteRequest): Promise<ArchivedPayload> {
    return Promise.reject(
      new Error(`S3Archive is not implemented yet (bucket ${this.bucket}) — see infra/modules/storage`),
    );
  }

  get(_objectKey: string): Promise<unknown> {
    return Promise.reject(new Error('S3Archive is not implemented yet'));
  }
}
