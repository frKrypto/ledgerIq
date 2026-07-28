# Database Schema

Canonical store design. Executable DDL: [`schema/schema.sql`](schema/schema.sql).

---

## 1. Design principles

1. **Source-agnostic canonical model.** QuickBooks, Plaid, and Stripe have incompatible models. The
   canonical layer is ours; connector-specific detail lives in `source_*` tables and JSONB payloads.
   If we later swap Plaid for a competitor, nothing downstream of `normalize` changes.
2. **Immutable lineage.** Every canonical row records where it came from and what transformed it.
   Non-negotiable — "show me the work" and every reconciliation dispute depend on it.
3. **Money is `NUMERIC(20,4)` in the DB and integer minor units in application code.** Never float,
   anywhere, for any reason.
4. **Tenant isolation via RLS on every tenant-scoped table.** Enforced in the database, not in
   application discipline.
5. **Bitemporal where it matters.** Financial records get restated. We keep both the effective date
   (when it happened economically) and the ingestion date (when we learned about it), so a report
   generated in March can be reproduced exactly in November.
6. **Soft delete everywhere.** Financial records are never hard-deleted; they are voided with an
   audit trail.
7. **Multi-currency and multi-entity ready from day one.** Not in the V1 product, but retrofitting
   currency into a schema is a migration nightmare. Every money column has a currency; every
   business belongs to an entity.

---

## 2. Domain map

```
IDENTITY & ACCESS          FINANCIAL CORE              INTELLIGENCE
─────────────────          ──────────────              ────────────
organizations              accounts                    metric_snapshots
users                      transactions ──┐            forecasts
memberships                journal_entries│            forecast_scores
firms                      invoices       ├─ lineage   health_scores
firm_clients               invoice_lines  │            alerts
api_keys                   bills          │            alert_rules
sessions                   bill_lines     │            scenarios
                           customers ─────┘            conversations
CONNECTIVITY               vendors                     messages
────────────               employees                   answer_traces
connections                payroll_runs                documents
sync_runs                  categories                  embeddings
raw_payloads               balances
entity_links               recurring_series           GOVERNANCE
                                                      ──────────
                                                      audit_log
                                                      data_access_log
```

---

## 3. Core tables and the reasoning behind them

### 3.1 `organizations`

The tenant boundary. One org = one business. Carries the business profile that drives product
adaptation: `business_model` (services / subscription / ecommerce / mixed) decides which metrics we
show, `naics_code` and `revenue_band` drive benchmarking cohorts, `fiscal_year_start_month` because
not every business is calendar-year and getting this wrong makes every annual metric wrong.

`entity_id` allows multiple legal entities under one org later, without a migration.

### 3.2 `connections` and the sync tables

`connections` holds one authorized link to a provider. Credentials are **not** stored here in
plaintext or under a global key — `credentials_encrypted` is sealed with a per-tenant data key from
the KMS hierarchy ([security §4](security.md#4-encryption)).

`status` is a product-visible field, not an internal one: `active | degraded | reauth_required |
error | disconnected`. The UI renders it. `last_successful_sync_at` drives the data-freshness display
that appears on every surface.

`sync_runs` records every attempt with counts and errors. This is what lets us answer "why is my data
stale?" without reading logs, and it's the input to connector health monitoring.

`raw_payloads` stores a pointer to the immutable S3 object plus a content hash. We keep raw payloads
for seven years. When a normalization bug is found, we replay from raw rather than re-fetching from a
provider that may no longer return the same data.

### 3.3 `transactions` — the hot table

The largest table and the one every query touches. Design decisions:

- **`direction` + positive `amount`**, rather than signed amounts. Signed amounts invite sign-error
  bugs in aggregation, and the sign convention differs between sources. An explicit enum makes the
  intent unambiguous at every call site.
- **`is_canonical` + `mirrors_transaction_id`.** The same economic event appears in multiple sources
  (a Stripe payout in Stripe, the bank, and QBO). We keep all copies for lineage but mark one
  canonical. Aggregations filter `is_canonical = true`. Deleting the duplicates instead would destroy
  our ability to reconcile against each source.
- **`is_transfer` + `transfer_pair_id`.** Internal movements are excluded from P&L. Missing this
  inflates both revenue and expense, which is the fastest way to lose a user's trust.
- **`category_id` with `category_source`** (`user_rule | source_system | classifier | llm | default`)
  and `category_confidence`. Knowing *how* something was categorized lets us surface low-confidence
  categorizations for review and lets the AI hedge appropriately.
- **`posted_at` vs `occurred_at`.** Cash timing vs. economic timing. Cash forecasting uses one,
  accrual P&L uses the other. Conflating them is a classic and invisible bug.
- Partitioned by `occurred_at` range (monthly) once volume justifies it; the DDL includes the
  partition-ready structure.

### 3.4 `invoices` / `bills` and receivables

`invoices` carries `due_date`, `expected_payment_date`, and `payment_probability` — the last two are
computed by the forecast engine from the customer's own payment history, not from terms. This is the
mechanism behind the forecasting accuracy claim in
[ai-cfo-engine §6](ai-cfo-engine.md#6-forecasting).

`customers.payment_behavior` (JSONB) caches the fitted lag distribution: mean days late, standard
deviation, sample count, and last refit date. Cached because refitting on every forecast run across
the fleet would be wasteful, and the distribution changes slowly.

### 3.5 `entity_links`

The entity-resolution table: maps `(source_system, source_entity_id)` → canonical entity, with a
`confidence` and a `resolution_method` (`exact_id | deterministic_key | fuzzy | human_confirmed`).
Fuzzy matches below threshold land in a review queue rather than silently merging two customers —
merging "Acme Corp" with "Acme Holdings" incorrectly would corrupt customer profitability analysis in
a way that's very hard to detect after the fact.

### 3.6 `metric_snapshots`

Materialized metric values keyed by `(org_id, metric_key, period_start, period_end, grain,
engine_version)`. Two reasons this exists rather than computing on read:

- **Performance.** Dashboard load touches ~40 metrics; recomputing from transactions each time is
  seconds, not milliseconds.
- **Reproducibility.** `engine_version` means an answer generated in March can be replayed exactly,
  even after we change how a metric is computed. Without this, audit and eval replay are impossible.

Invalidated on data change for the affected periods, recomputed asynchronously.

### 3.7 `forecasts` and `forecast_scores`

`forecasts` stores the full projection (daily points with P10/P50/P90, plus the stream decomposition)
as a snapshot with `generated_at`. `forecast_scores` is populated later, as actuals arrive, with MAPE
at 7/30/90 days.

**`forecast_scores` is the flywheel table.** It produces no user value for a year and is the single
most strategically important table in the schema
([engine §8](ai-cfo-engine.md#8-the-forecast-accuracy-flywheel)). It must be correct from the first
forecast we ever generate, because the data cannot be reconstructed retroactively.

### 3.8 `answer_traces`

Every AI answer, fully recorded: question, classification, plan, executed results with provenance,
prompt version, model, narrator output with slots, verifier results, latency, tokens, cost, and user
feedback.

Serves four purposes: user-facing "show the work", audit and dispute resolution, eval replay when
prompts change, and cost attribution per org. Retained per the data retention policy; the financial
values inside are subject to the same access controls as the underlying data.

### 3.9 `audit_log` and `data_access_log`

Separate tables on purpose. `audit_log` records mutations (who changed what, before/after). 
`data_access_log` records reads of financial data, which SOC 2 and any bank-adjacent security review
will ask for. Both are append-only, enforced by table permissions — the application role has INSERT
but not UPDATE or DELETE.

---

## 4. Row-level security

Every tenant-scoped table carries `org_id NOT NULL` and this policy shape:

```sql
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON transactions
  USING (org_id = current_setting('app.current_org_id', true)::uuid);
```

`FORCE` matters — without it the table owner bypasses the policy, which silently defeats the control
in exactly the environment where it's most likely to be exercised.

### Verified behavior

The DDL was applied to PostgreSQL 16.13 and the policies exercised directly. Results:

| Scenario (as non-superuser `app_role`) | Result |
|---|---|
| `SELECT * FROM transactions` with tenant context set, **no `WHERE` clause** | Only that tenant's rows |
| `SELECT ... WHERE org_id = '<other tenant>'` — deliberate cross-tenant attempt | 0 rows |
| Query with **no** `app.current_org_id` set — simulating a forgotten scope | 0 rows — **fails closed** |

The fail-closed behavior on missing context is the important one: a bug that forgets to set the
tenant context returns nothing, rather than returning everything.

### The caveat that would silently disable all of it

**Superusers and roles with `BYPASSRLS` ignore these policies entirely, `FORCE` notwithstanding.**
Verified: a superuser session with `app.current_org_id` set to one org still saw every org's rows.

So the isolation guarantee is conditional on a deployment fact, not just on the schema: the
application must connect as a role that is `NOSUPERUSER`, `NOBYPASSRLS`, and **not the owner of these
tables**. Running migrations as an owner role is fine; serving traffic as one silently removes the
control while every policy still appears correctly configured in the schema.

This is enforced in Terraform and asserted in the tenancy CI suite — the suite checks
`rolsuper = false AND rolbypassrls = false` for the application role before running its isolation
cases, because otherwise those cases would pass for the wrong reason.

The session variable is set by the data-access layer from the authenticated request context. There
is no code path that constructs a query without a tenant context; this is enforced by the repository
type signatures, and verified by the adversarial CI suite described in
[architecture §6](architecture.md#6-multi-tenancy-and-isolation).

Firm-tier access (an accountant seeing many clients) does **not** weaken this. The firm user's
session sets `app.current_org_id` to exactly one client org at a time, with the grant validated
against `firm_clients`. Cross-client rollups run as a series of scoped queries, not one unscoped
query — slower, and correct.

---

## 5. Indexing strategy

Driven by actual access patterns rather than guessing:

| Pattern | Index |
|---|---|
| Dashboard: transactions for org over a period | `(org_id, occurred_at DESC) WHERE is_canonical AND NOT is_transfer` |
| Category breakdown | `(org_id, category_id, occurred_at)` |
| Customer profitability | `(org_id, customer_id, occurred_at)` |
| AR aging | `(org_id, status, due_date) WHERE status IN ('open','overdue')` |
| Metric lookup | unique `(org_id, metric_key, grain, period_start, engine_version)` |
| Dedup candidate search | `(org_id, amount, occurred_at)` + trigram on `description` |
| Alert evaluation sweep | `(org_id, status, next_evaluation_at)` on `alert_rules` |

Partial indexes on the canonical/non-transfer predicate matter a lot: they're the filter on nearly
every analytical query, and excluding mirrors and transfers from the index keeps it substantially
smaller than the table.

---

## 6. Migration policy

- **Expand/contract only.** Add nullable column → backfill → start writing → start reading → stop
  writing old → drop, across separate deploys. Never a destructive change in the same deploy as the
  code that stops using the column.
- **No blocking locks in production.** `CREATE INDEX CONCURRENTLY`, no `ALTER TABLE` that rewrites a
  large table without a documented maintenance plan.
- **Every migration reversible** or explicitly documented as one-way with a rationale.
- **Backfills run as jobs**, not in migrations. A migration that takes 40 minutes blocks deploys.
- **Metric changes bump `engine_version`** rather than mutating history. Historical answers keep
  explaining themselves under the version that produced them.
