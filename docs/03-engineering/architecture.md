# Technical Architecture

**Audience:** engineering. Read [tech-stack.md](tech-stack.md) for *why* each technology, and
[ai-cfo-engine.md](ai-cfo-engine.md) for the reasoning layer in depth.

---

## 1. The shape of the problem

LedgerIQ is not a CRUD app with an LLM bolted on. Structurally it is:

1. A **data integration pipeline** that pulls from unreliable third-party APIs with inconsistent
   models and no transactional guarantees
2. A **semantic normalization layer** that turns four incompatible representations of "money moved"
   into one queryable truth
3. A **deterministic analytics engine** that computes financial metrics correctly and reproducibly
4. A **reasoning layer** that plans analysis, calls the engine, and explains results
5. A thin **application layer** over all of it

Most of the risk and nearly all of the durable value live in layers 2 and 3. Teams building in this
space usually over-invest in 5 and under-invest in 2, then discover a year in that their numbers
don't tie out and they cannot fix it without a rewrite.

**The architectural principle that follows:** the reasoning layer is a *client* of the analytics
engine, never a substitute for it. If the LLM disappeared tomorrow, the metric engine would still
produce every number in the product, correctly.

---

## 2. Strategic position in the stack

We deliberately sit **above the ledger, below the decision**.

```
        ┌──────────────────────────────────────────┐
        │  Decisions the owner makes               │  ← we want to be here
        ├──────────────────────────────────────────┤
        │  LEDGERIQ — semantic layer + reasoning   │  ← we build here
        ├──────────────────────────────────────────┤
        │  Systems of record: QBO, banks, Stripe   │  ← we integrate, don't replace
        └──────────────────────────────────────────┘
```

Owning the semantic layer is a strong position because it is the only layer with a *complete* view.
QuickBooks sees the GL. Plaid sees cash. Stripe sees one revenue stream. Only we see all of it
reconciled — and reconciliation is where the insight lives.

The long-term question is whether we eventually move down and own the ledger. The answer is: only
after the semantic layer is a business, and only if the data quality ceiling of third-party books
becomes the binding constraint on product quality. It is a Phase 4+ discussion, and framing it as a
near-term goal would be a strategic error.

---

## 3. System overview

```
┌─────────────┐   ┌─────────────┐   ┌──────────┐   ┌──────────┐
│  QuickBooks │   │    Plaid    │   │  Stripe  │   │   ...    │
└──────┬──────┘   └──────┬──────┘   └────┬─────┘   └────┬─────┘
       │ OAuth/webhook   │               │              │
       └────────┬────────┴───────┬───────┴──────────────┘
                ▼                ▼
        ┌───────────────────────────────────┐
        │   INGESTION SERVICE               │
        │   • connector adapters            │
        │   • sync scheduler + backfill     │
        │   • rate limiting, retry, DLQ     │
        │   • raw payload archive (S3)      │
        └───────────────┬───────────────────┘
                        ▼
        ┌───────────────────────────────────┐
        │   NORMALIZATION PIPELINE          │
        │   • canonical mapping             │
        │   • dedup / transfer matching     │
        │   • entity resolution (customers, │
        │     vendors) across sources       │
        │   • categorization (rules + ML)   │
        │   • lineage capture               │
        └───────────────┬───────────────────┘
                        ▼
        ┌───────────────────────────────────────────────────┐
        │   CANONICAL STORE (Postgres, RLS per tenant)      │
        │   accounts · transactions · invoices · bills ·    │
        │   customers · vendors · employees · payroll ·     │
        │   journal entries · balances                      │
        └───────────────┬───────────────────────────────────┘
                        ▼
        ┌───────────────────────────────────────────────────┐
        │   METRIC ENGINE (deterministic, versioned)        │
        │   • metric catalog (typed, unit-tested)           │
        │   • period math, comparisons, decomposition       │
        │   • forecast engine (structural + empirical)      │
        │   • health score, anomaly detection               │
        │   → every result carries provenance               │
        └───────────────┬───────────────────────────────────┘
                        ▼
        ┌───────────────────────────────────────────────────┐
        │   REASONING LAYER                                 │
        │   Planner → Executor → Verifier → Narrator        │
        │   (calls metric engine as tools; cannot compute)  │
        └───────────────┬───────────────────────────────────┘
                        ▼
        ┌───────────────────────────────────────────────────┐
        │   API (tRPC + REST) → Next.js app · alerts ·      │
        │   reports · webhooks · firm console               │
        └───────────────────────────────────────────────────┘
```

Cross-cutting: job queue, audit log, observability, feature flags, secrets management.

---

## 4. Service boundaries

**Start as a modular monolith.** One deployable, hard internal module boundaries, separate
databases-schemas per domain, no cross-module imports except through defined interfaces. Extract
services only when a specific scaling or isolation need appears.

At seed stage, microservices buy you distributed-systems debugging in exchange for organizational
decoupling you don't need with six engineers. The cost is real and the benefit is zero until the
team is ~25 people.

Modules and their extraction triggers:

| Module | Responsibility | Extract when |
|---|---|---|
| `ingest` | Connector adapters, sync orchestration, raw archive | Sync volume causes noisy-neighbor latency on the API — likely first to go, ~2K businesses |
| `normalize` | Canonicalization, entity resolution, categorization | Rarely — tightly coupled to ingest; extract together |
| `metrics` | Metric catalog, period math, decomposition | Only if compute becomes the bottleneck; more likely we add read replicas + cache |
| `forecast` | Projection models, scenario simulation, scoring | When model training/serving needs different hardware or a Python runtime |
| `reason` | Planner, executor, verifier, narrator, eval harness | Early candidate — different scaling profile (long-lived streaming connections), different failure modes |
| `notify` | Alert evaluation, channel delivery, preferences | Low pressure; keep in monolith |
| `report` | Document generation, export, scheduling | When PDF rendering memory spikes hurt the API |
| `api` | HTTP/tRPC surface, auth, rate limiting, RBAC | Never — it's the front door |

**The one exception at day one:** `reason` runs on its own process/deployment from the start, even in
the monolith. LLM calls are slow, streaming, and failure-prone; letting them share a request pool
with page loads is how you get cascading timeouts.

---

## 5. Data flow: sync → answer

**Ingestion.** Each connector is an adapter implementing a common interface: `authorize`,
`fullSync`, `incrementalSync`, `handleWebhook`, `healthCheck`. Adapters emit raw payloads to S3
(immutable, encrypted, 7-year retention for audit) and enqueue normalization jobs.

Sync cadence: webhook-driven where the provider supports it (Stripe, QBO change-data-capture),
otherwise polling — hourly for banks during business hours, every 4 hours for accounting, daily full
reconciliation sweep to catch missed deltas. Never trust a provider's webhook delivery as the sole
path; the reconciliation sweep is what keeps us correct.

**Normalization** is where the hard problems live:

- **Deduplication.** A Stripe payout appears in Stripe, in the bank feed, and in QuickBooks. Counting
  it three times is the classic failure. We match on amount + date window + fuzzy descriptor +
  known-transfer-pair heuristics, then mark canonical vs. mirror records. Every dedup decision is
  logged and reversible.
- **Transfer matching.** Money between the user's own accounts is not revenue or expense. Missing
  this inflates both sides of the P&L and destroys credibility instantly.
- **Entity resolution.** "ACME Corp", "Acme Corporation", and "ACME CORP LLC" across three systems
  are one customer. We use deterministic keys where available (Stripe customer ID ↔ QBO customer
  ref), and blocked fuzzy matching with a human-confirmable review queue otherwise.
- **Categorization.** Layered: user-defined rules first, then the QBO chart-of-accounts mapping,
  then a trained classifier, then LLM fallback for genuinely novel merchants. The LLM is the last
  resort, not the first, because it's slow, costs money, and is less consistent than a rule.
- **Lineage.** Every canonical record stores the source system, source ID, raw payload pointer, and
  the transform version that produced it. Without this, "show me the work" is impossible and every
  reconciliation dispute is unresolvable.

**Metric computation.** The metric catalog is a registry of typed, pure functions:

```ts
defineMetric({
  key: 'gross_margin',
  unit: 'ratio',
  inputs: ['revenue', 'cogs'],
  grain: ['month', 'quarter', 'year'],
  compute: (ctx) => (ctx.revenue - ctx.cogs) / ctx.revenue,
  requires: { sources: ['accounting'], minHistoryDays: 60 },
  explain: (r) => `Gross margin of ${pct(r.value)} — ${money(r.revenue)} revenue less ${money(r.cogs)} COGS.`,
});
```

Properties that matter: every metric is unit-tested against golden fixtures; every metric declares
its data requirements so the UI can hide what it can't honestly compute; every result carries
provenance (which records, which period, which engine version). Metric definitions are versioned —
when we change how gross margin is computed, historical answers still explain themselves under the
version they were computed with.

**Reasoning.** Detailed in [ai-cfo-engine.md](ai-cfo-engine.md). Summary: a planner turns the
question into a typed plan over metric-engine tools; an executor runs it; a verifier checks the
narration against computed values; the narrator writes prose with numeric slots that the renderer
fills from verified results.

---

## 6. Multi-tenancy and isolation

Financial data raises the cost of a tenancy bug from "embarrassing" to "company-ending."

**Defense in depth, three layers:**

1. **Row-level security in Postgres.** Every tenant-scoped table has `org_id` with an RLS policy
   bound to a session variable set from the authenticated request. A missing `WHERE` clause in
   application code cannot leak data.
2. **Application-layer scoping.** The data access layer requires an explicit tenant context object;
   there is no way to construct a query without it. Enforced by types, not convention.
3. **A CI test that tries to break it.** A test suite that runs every repository method with tenant A's
   context against tenant B's data and asserts empty results. This runs on every PR and is the single
   highest-value test in the codebase.

Encryption keys for third-party credentials are per-tenant, derived from a KMS-held root. A dumped
database yields no usable connector tokens.

Large firm-tier customers who require it get a dedicated database. The schema and access layer are
identical, so this is a deployment concern rather than a code fork.

---

## 7. Handling the reality of third-party APIs

Every connector will break. Plan for it as normal operation, not as an incident.

- **Circuit breakers** per provider; a QBO outage must not fail the whole sync tier
- **Dead-letter queue** with automatic replay after recovery, and an operator UI for inspection
- **Data-freshness state is a first-class product concept**, not an error state. The UI always shows
  when each source last synced. If Plaid has been down for six hours, the user sees "bank data as of
  6am" rather than a silently stale number — silent staleness in a cash forecast is a trust-killer.
- **Graceful degradation:** if accounting data is stale but bank data is fresh, we still answer cash
  questions and say clearly which answers are affected.
- **Re-auth is a scheduled reality.** Bank connections break every few months. We detect, notify
  through escalating channels, and make reconnection a two-click flow — not an email with a link to
  a settings page.

---

## 8. Scaling plan

Design target: **10,000 businesses without re-architecture.** Documented path to 100,000.

Rough shape of the load per business: ~5–50K transactions/year, nightly forecast recompute (~1–3s of
compute), a handful of chat answers per week, one weekly report.

| Concern | To 10K businesses | Beyond |
|---|---|---|
| Primary DB | Single Postgres, read replicas for analytics reads | Partition transactions by `org_id`; consider Citus |
| Metric compute | Materialized rollups refreshed on data change, cached by `(org, metric, period, engine_version)` | Move heavy aggregation to a columnar store (ClickHouse) fed by CDC |
| Forecast | Nightly batch across the fleet, ~hours of worker time | Shard by org hash; scale workers horizontally — embarrassingly parallel |
| LLM | Provider-managed capacity, prompt caching on the static system context | Route by complexity tier; small model for classification and simple lookups, frontier only for genuine reasoning |
| Ingest | Queue-based workers, per-provider rate limits | Dedicated ingest service, per-provider worker pools |

**The cost driver to watch is inference, and the lever is routing.** Not every question needs a
frontier model. Question classification, entity extraction, and simple metric lookups run on a small
fast model; multi-step reasoning and narrative generation run on the frontier model. Getting this
routing right is worth more to gross margin than any infra optimization. Modeled in
[pricing §7](../04-business/pricing.md#7-cogs-and-gross-margin).

---

## 9. Failure modes we design against

| Failure | Blast radius | Design response |
|---|---|---|
| LLM emits a wrong number | Catastrophic — permanent trust loss | Model cannot emit numbers; verifier rejects unslotted numerics ([engine §5](ai-cfo-engine.md#5-the-verifier)) |
| Cross-tenant leak | Company-ending | RLS + typed tenant context + adversarial CI suite (§6) |
| Duplicate transaction inflates revenue | Severe — every downstream number wrong | Dedup with logged decisions; nightly reconciliation against source-system totals with alerting on divergence |
| Stale data presented as current | Severe — a stale cash forecast is worse than none | Freshness is rendered on every surface; answers state their data-as-of |
| Forecast is confidently wrong | High | Confidence bands always shown; accuracy tracked and published; degrade to a wider band under thin history |
| LLM provider outage | Moderate | Multi-provider abstraction; cached answers for common questions; the dashboard and alerts keep working because they don't depend on the LLM |
| Connector breaks silently | Moderate | Reconciliation sweep detects divergence, not just API errors |

---

## 10. Key architectural decisions (ADR summary)

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| 001 | Deterministic metric engine; LLM narrates only | LLM computes from raw data in context | Correctness is the product. Non-negotiable. |
| 002 | Modular monolith | Microservices from day one | Team size. Extraction triggers documented per module (§4). |
| 003 | Postgres as canonical store | Warehouse-first (BigQuery/Snowflake) | Transactional needs, RLS, and sub-second reads dominate at our scale. Add columnar later via CDC. |
| 004 | Structural forecast, not learned end-to-end | ML forecast from day one | Explainability, cold start, and accuracy all favor structural until we have outcome data. |
| 005 | Sit above the ledger | Build our own GL | Scope and competitive positioning (§2). |
| 006 | Three connectors at launch | Breadth of integrations | Engineering leverage; see [integrations](integrations.md). |
| 007 | Vector search for documents only, not for financial facts | RAG over financial data | Financial questions need exact aggregation, not semantic similarity. Embeddings can't sum. |
| 008 | Per-tenant credential encryption keys | Single application key | Limits blast radius of a DB compromise. |

Decision 007 deserves emphasis because it's a common and expensive mistake: teams reach for a vector
database to "let the AI query the financials," embedding transactions and retrieving the top-k
similar ones. This cannot produce a correct sum, ever. Vector search has exactly one legitimate role
here — retrieving *unstructured* context (uploaded contracts, prior answers, documentation) — and
that is how we use it.
