/**
 * Branded entity identifiers.
 *
 * Every id in this system is a UUID, which means the compiler cannot normally
 * stop you passing a userId where an orgId is expected. In a multi-tenant
 * financial product that particular mix-up is a data-exposure bug, so the ids
 * are branded and must be constructed through a checked constructor.
 */

declare const IdBrand: unique symbol;

type Id<TTag extends string> = string & { readonly [IdBrand]: TTag };

export type OrgId = Id<'org'>;
export type UserId = Id<'user'>;
export type MembershipId = Id<'membership'>;
export type FirmId = Id<'firm'>;
export type ConnectionId = Id<'connection'>;
export type SyncRunId = Id<'syncRun'>;
export type ApiKeyId = Id<'apiKey'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidIdError extends Error {
  constructor(value: string, kind: string) {
    super(`Invalid ${kind} id: ${JSON.stringify(value)}`);
    this.name = 'InvalidIdError';
  }
}

function makeIdFactory<T extends string>(kind: string) {
  return (value: string): Id<T> => {
    if (!UUID_RE.test(value)) throw new InvalidIdError(value, kind);
    return value as Id<T>;
  };
}

export const orgId = makeIdFactory<'org'>('organization');
export const userId = makeIdFactory<'user'>('user');
export const membershipId = makeIdFactory<'membership'>('membership');
export const firmId = makeIdFactory<'firm'>('firm');
export const connectionId = makeIdFactory<'connection'>('connection');
export const syncRunId = makeIdFactory<'syncRun'>('syncRun');
export const apiKeyId = makeIdFactory<'apiKey'>('apiKey');

export const isUuid = (value: string): boolean => UUID_RE.test(value);
