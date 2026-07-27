# Infrastructure

Terraform, one module per concern, remote state in S3 with DynamoDB locking.
Full plan: [../docs/03-engineering/deployment.md](../docs/03-engineering/deployment.md).

## Status

Sprint 1 ships the `database` module only, because it carries a security control
that cannot be added later without a migration: the application role's
`NOSUPERUSER` / `NOBYPASSRLS` attributes. Everything else is scaffolded in the
sprints that need it.

| Module | Status | Sprint |
|---|---|---|
| `database` | Written | 1 |
| `network` (VPC, subnets, endpoints) | Not started | 2 |
| `ecs-service` (api, reason, workers) | Not started | 2 |
| `queue` (ElastiCache/Redis) | Not started | 2 |
| `storage` (S3 raw archive, Object Lock) | Not started | 2 |
| `secrets` (KMS hierarchy, per-tenant DEKs) | Not started | 2 |
| `observability` | Not started | 5 |

## Rules

- **No console changes.** Drift detection runs nightly and alerts.
- `plan` output is posted to the PR and required for review.
- Staging and production differ by size and data, never by shape — composed from
  the same modules with different variables. A staging environment shaped
  differently from production predicts nothing.

## The one thing not to change casually

`postgresql_role.app` must stay `superuser = false` and
`bypass_row_level_security = false`. Both were verified against PostgreSQL 16.13
to bypass every RLS policy when true, `FORCE ROW LEVEL SECURITY` notwithstanding.
The application refuses to boot if either is set, and CI asserts it — but the
cheapest place to get it right is here.
