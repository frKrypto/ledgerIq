# Contributing

## Setup

```bash
npm install
docker compose up -d postgres          # or any Postgres 16
cp .env.example .env

createdb -h localhost -U postgres ledgeriq_dev ledgeriq_test
npm run db:migrate                     # applies migrations as the owner role
npm -w @ledgeriq/db run bootstrap      # creates the ledgeriq_app role

npm test
```

## The rules that aren't negotiable

Everything else is style. These three are correctness, and CI enforces all of them.

### 1. Money is never a JavaScript `number`

Use `@ledgeriq/core/money`. Integer minor units in a branded type, decimal strings
at the database boundary. `0.1 + 0.2 !== 0.3` in binary floating point, and in a
financial product that discrepancy eventually reaches a customer's P&L.

```ts
import * as Money from '@ledgeriq/core/money';

const salary = Money.fromDecimalString('120000.00', 'USD');
const loaded = Money.multiply(salary, 1.3);   // $156,000.00, exactly
```

`NUMERIC` and `BIGINT` columns are returned as strings by `pg` and must stay that
way — `packages/db/src/client.ts` pins the type parsers, and a test asserts it.

### 2. Tenant data is only reachable through `withTenant`

```ts
const connections = await withTenant(pool, ctx, async (db) =>
  listConnections(db),                 // takes TenantDb — nothing else compiles
);
```

There is no exported handle that queries tenant tables without a scope. Repository
functions take a `TenantDb`, which only `withTenant` can produce. This is why
repository queries contain no `org_id` predicate: row-level security supplies it,
and adding a redundant filter would imply the policy is optional.

If you genuinely need cross-tenant access, `unsafeWithoutTenantScope` exists, is
deliberately ugly, requires a written reason, and is restricted by a lint rule to
migrations, admin CLIs, and fan-out jobs. Adding a file to that allowlist is a
reviewable decision, which is the point.

### 3. The tenancy suite blocks CI with no override

`packages/db/test/tenancy.test.ts` guards the failure that ends the company: one
customer seeing another's financials. It runs in under a second against a real
Postgres. There is no deadline that justifies merging past it, so the tooling
offers no way to.

Adding a table with an `org_id` column means adding it to `TENANT_SCOPED_TABLES`
and writing its RLS policy. A table in neither that list nor `GLOBAL_TABLES`
fails the suite rather than shipping unprotected.

## Why tests use two database roles

- **owner/admin** — runs migrations, seeds fixtures. Bypasses RLS.
- **`ledgeriq_app`** — `NOSUPERUSER`, `NOBYPASSRLS`, not the owner. Serves traffic.

Verified against PostgreSQL 16.13: superusers and `BYPASSRLS` roles ignore every
policy, `FORCE ROW LEVEL SECURITY` notwithstanding. A suite that tests isolation
using the admin role proves nothing — it would be green over an open door. So §0
of the tenancy suite asserts the role's attributes *before* running any isolation
case.

## Migrations

Numbered SQL in `packages/db/migrations/`, forward-only, checksummed. Editing an
applied migration is an error rather than a silent no-op.

Expand/contract only: add nullable column → backfill → write → read → stop writing
old → drop, across separate deploys. Never a destructive change in the same deploy
as the code that stops using the column. Backfills are jobs, not migrations — a
migration that takes 40 minutes blocks deploys.

## Definition of done

1. Tests at the appropriate layer; golden fixtures still exact-match
2. Tenancy suite covers any new access path
3. Instrumentation exists for the production signals the change affects
4. Degradation is defined — what happens when its data source is stale or absent
5. A runbook entry if it introduces a new failure mode

Full strategy: [docs/03-engineering/testing.md](docs/03-engineering/testing.md).
