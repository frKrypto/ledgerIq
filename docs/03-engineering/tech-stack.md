# Tech Stack Evaluation

Every choice below states the alternative we rejected and the tradeoff we're accepting. Choices made
because "everyone uses it" are flagged as such — sometimes ecosystem size *is* the right reason, but
it should be said out loud rather than disguised as engineering judgment.

**The meta-principle:** optimize for *iteration speed on the reasoning layer* and *correctness in the
data layer*. Everything else is a commodity decision where the right answer is the boring one.

---

## 1. Language

### TypeScript everywhere, with Python only where it earns its place

**Decision:** TypeScript for the app, API, ingestion, normalization, and metric engine. Python only
for forecasting models and any ML training.

**Rejected:** Python for the backend. Go for services.

**Reasoning.** The single biggest source of bugs in a financial product is a type mismatch at a
system boundary — a string where a decimal should be, a nullable that wasn't handled, a currency
unit confusion. End-to-end TypeScript with a shared schema package means the metric engine, the API,
and the UI share one definition of what a `MoneyAmount` is. That is worth more than Python's
numerical ecosystem for the 90% of the codebase that isn't doing numerics.

Python earns its place in forecasting (statsmodels, prophet-class decomposition, scikit-learn) where
rewriting the ecosystem in TS would be genuinely foolish. The boundary is a well-defined RPC surface,
not a scattering of scripts.

**Tradeoff accepted:** we run two runtimes. Mitigated by keeping the Python surface deliberately
small and behind one interface.

**Non-negotiable:** money is never a JavaScript `number`. All monetary values are integer minor units
(cents) in a branded type, with a decimal library at computation boundaries. Floating-point cents in
a finance product is a career-defining bug.

---

## 2. Frontend

### Next.js (App Router) + React + TypeScript

**Rejected:** Remix (smaller ecosystem, and the gap narrowed), SvelteKit (better DX, materially
smaller hiring pool and component ecosystem), plain SPA + separate API (loses streaming SSR, which
we specifically want).

**Reasoning.** Two capabilities decide it: React Server Components let the heavy dashboard render on
the server with data already resolved, and streaming lets AI answers appear token-by-token without
building a bespoke transport. Both are core to this product's feel. The hiring pool argument is real
and I'm counting it openly.

**Tradeoff:** App Router complexity and the risk of framework churn. Mitigated by keeping business
logic out of framework-specific code — the metric engine and reasoning layer have no Next.js imports.

### Styling: Tailwind CSS + Radix UI primitives + custom component layer

**Rejected:** a component library like MUI or Ant (fights you on custom design; this product's
credibility depends on looking better than accounting software), CSS-in-JS (runtime cost, RSC
friction), shadcn wholesale (good starting point, but we should own the components rather than vendor
someone's design decisions into our codebase permanently).

**Reasoning.** Radix gives accessible, unstyled behavior for the hard components (dialog, popover,
combobox) — accessibility is where hand-rolled components fail. Tailwind gives velocity and forces
design-token discipline. The custom layer on top is where our design system lives, and it's ours.

### Data visualization: Visx + D3 scales, not a charting library

**Rejected:** Recharts, Chart.js, Nivo.

**Reasoning.** Our charts have unusual requirements: confidence bands, annotated risk events on a
timeline, drill-down interactions on every data point, and a strict design language. Charting
libraries make the first 80% fast and the last 20% impossible. Visx gives D3's power as React
components. We're going to spend real design effort on the forecast chart specifically — it's the
signature visual of the product.

**Tradeoff:** slower initial chart development. Accepted deliberately.

### State: Server state via TanStack Query; client state via Zustand; forms via React Hook Form + Zod

**Rejected:** Redux (ceremony without benefit here), Context for everything (re-render problems at
dashboard scale).

**Reasoning.** Most of our state is server state, which is a cache-coherence problem, not a state
problem. TanStack Query solves that specific problem well. The genuinely client-side state (open
panels, scenario editor drafts, chat composition) is small enough that Zustand is sufficient. Zod
schemas are shared with the API layer so validation is defined once.

---

## 3. Backend & API

### tRPC for the first-party app, REST + OpenAPI for public/partner API

**Rejected:** GraphQL, REST-only, gRPC.

**Reasoning.** tRPC gives end-to-end type safety with zero codegen for our own client — a real
velocity gain for a small team, and it makes refactoring the metric surface safe. GraphQL's benefits
(client-specified queries, multiple consumers) don't apply when there's one first-party client, and
its costs (N+1 management, query complexity limits, caching difficulty, security surface) are real.

The public API is separately designed REST with OpenAPI, because partners and the accountant-tooling
ecosystem expect REST, and because a public API should be a deliberate contract, not an accidental
projection of internal types. See [api-spec.md](api-spec.md).

### Runtime: Node.js on long-running containers, not serverless functions

**Rejected:** Vercel/Lambda serverless for the API tier.

**Reasoning.** Our workload is exactly the shape serverless is bad at: long-lived streaming
connections for AI responses, persistent DB connection pools, and multi-second background jobs. Cold
starts on a 12-second reasoning request are unacceptable, and connection pooling from ephemeral
functions to Postgres is a known operational tax.

The Next.js frontend can deploy to a serverless edge; the API and workers run as containers.

---

## 4. Database

### PostgreSQL as the canonical store

**Rejected:** MySQL (weaker JSON, no native RLS of comparable maturity), MongoDB (financial data is
deeply relational — this would be self-harm), a warehouse-first design (below).

**Reasoning.** Three Postgres-specific features are load-bearing for us:

- **Row-level security** — the tenancy isolation strategy in [architecture §6](architecture.md#6-multi-tenancy-and-isolation) depends on it
- **`NUMERIC`** — exact decimal arithmetic in the database
- **JSONB** — raw connector payloads and flexible metadata alongside relational core, without a
  second datastore

Add `pgvector` for document embeddings (small volume; a dedicated vector DB is unjustified
complexity at our scale) and TimescaleDB-style partitioning on the transactions table if and when
volume demands it.

**Why not warehouse-first (BigQuery/Snowflake/DuckDB):** tempting because this is analytics, but our
access pattern is thousands of small tenant-scoped queries with sub-second latency requirements, not
a few large scans. Warehouses are the wrong latency and cost profile for that. The right move is
Postgres now, and CDC into a columnar store (ClickHouse) when fleet-wide analytical queries or
benchmark computation demand it — around 10K businesses.

### ORM: Drizzle

**Rejected:** Prisma (heavy runtime, historically awkward with raw SQL and RLS session variables,
migration model we'd fight), raw SQL only (loses type safety, which is the whole point of the TS
choice), TypeORM (no).

**Reasoning.** Drizzle is a thin, typed layer over SQL that doesn't hide SQL. For a product where
we will write genuinely complex analytical queries, "doesn't fight raw SQL" is the deciding property.
It also handles session-variable-based RLS cleanly.

### Cache & queue: Redis + BullMQ

**Rejected:** SQS/Cloud Tasks (fine, but adds cloud coupling and worse local dev), Temporal
(genuinely good for long-running workflows and worth revisiting for multi-step sync orchestration,
but the operational overhead isn't justified at seed stage).

**Reasoning.** BullMQ covers scheduled syncs, retries with backoff, dead-letter queues, and job
prioritization with an operable dashboard. Redis is also our cache for computed metrics.

**Flagged for revisit:** if sync orchestration grows to multi-day, multi-step workflows with complex
compensation logic, Temporal becomes the right answer. Note the trigger, don't pre-pay the cost.

---

## 5. AI layer

### Models: Claude as primary, with a provider abstraction and tiered routing

**Reasoning.** The reasoning tasks here — decomposing a financial question into an analysis plan,
following a strict output contract, explaining causally without overstating — are exactly the
"careful, instruction-following, long-context reasoning" profile. Claude models are strong at
structured tool use and at *not* fabricating when data is absent, which is disproportionately
important for us.

**Tiered routing is a first-class design concern, not an optimization:**

| Tier | Used for | Model class |
|---|---|---|
| Fast | Question classification, intent routing, entity extraction, simple lookups | Small model (Haiku-class) |
| Reasoning | Multi-step planning, causal analysis, scenario modeling, narrative generation | Frontier model (Opus/Sonnet-class) |
| Batch | Report generation, weekly briefs, bulk categorization | Frontier model via batch API at reduced cost |

Roughly 60–70% of calls should land in the fast tier. That ratio is the main lever on gross margin;
it is tracked as an engineering metric, not just a finance one.

**Provider abstraction:** all model calls go through one internal interface with typed
request/response, automatic retry, token accounting per org, and prompt-version tagging. Swapping or
adding a provider must be a config change. We are not building a lowest-common-denominator
abstraction over every provider's features — just enough to avoid a rewrite if we need to move.

**Prompt caching** on the static system context (metric catalog, tool definitions, output contract)
is a large and easy cost win given how much of our prompt is constant.

### Vector database: pgvector, for documents only

**Rejected:** Pinecone, Weaviate, Qdrant.

**Reasoning.** Our vector workload is small and narrow: uploaded documents (contracts, loan terms,
prior reports), help content, and past Q&A for consistency. Tens of thousands of vectors per tenant
at most. pgvector handles that comfortably and keeps it in the same transactional, RLS-protected
store. A separate vector service would add a second consistency domain and a second tenancy-isolation
problem for no benefit.

Restating the point from [architecture §10](architecture.md#10-key-architectural-decisions-adr-summary)
because it's the most common mistake in this category: **financial facts are never retrieved by
embedding similarity.** Aggregation is a SQL problem. Vectors are for prose.

### Evaluation: a first-class internal system, not a vendor

**Reasoning.** We build our own eval harness because our correctness criteria are unusual — we need
to assert that stated numbers exactly match engine-computed values, which no generic LLM-eval product
checks. Detail in [ai-cfo-engine §7](ai-cfo-engine.md#7-evaluation). We use LangSmith or Braintrust
for *tracing and observability* of model calls; we do not outsource correctness.

### Not using: LangChain / LlamaIndex

**Reasoning.** Our orchestration is a specific, opinionated pipeline (plan → execute → verify →
narrate) with hard correctness constraints at each step. Framework abstractions would obscure exactly
the control we need most, and the indirection makes debugging a wrong answer significantly harder.
This is maybe 800 lines of orchestration code we should own outright.

---

## 6. Auth & identity

### WorkOS for auth and enterprise identity

**Rejected:** Auth0 (pricing scales painfully; SMB-per-seat economics get ugly), Clerk (excellent DX,
weaker on the enterprise SSO/SCIM path we'll need for firm-tier customers), roll-your-own (never, for
a financial product).

**Reasoning.** The firm tier and larger customers will demand SAML SSO, SCIM provisioning, and
directory sync. WorkOS makes those a configuration rather than a quarter of engineering, and its
pricing model doesn't punish per-seat growth the way Auth0's does. It also covers audit-log export
requirements that show up in SOC 2 and in enterprise security reviews.

MFA is mandatory for all users, not optional — this is financial data. Passkeys as the primary
factor, TOTP as fallback, SMS only as a last resort (SIM-swap risk is real for this user base).

---

## 7. Cloud & infrastructure

### AWS

**Rejected:** GCP (good, but weaker fintech-vendor ecosystem and less common in SOC 2 / bank security
review conversations), Azure (no), Vercel-only (insufficient for containers, queues, and VPC
requirements).

**Reasoning.** Honestly: AWS wins here on *institutional trust and ecosystem*, not on technical
merit. When a customer's security team or an acquirer's diligence reviews us, AWS is the
zero-friction answer. KMS, Nitro Enclaves (if we ever need them), PrivateLink, and mature compliance
tooling matter more than any specific service quality difference. Startup credits are material at
this stage too.

**Services:** ECS Fargate (not EKS — Kubernetes is an operational burden we don't need until there's
a platform team), RDS Postgres Multi-AZ, ElastiCache, S3 with object lock for the raw archive, KMS
for per-tenant key hierarchy, Secrets Manager, CloudFront.

**Rejected specifically: Kubernetes.** It is the default answer for people who like infrastructure.
For a six-engineer team, ECS Fargate delivers 95% of the value at 20% of the operational cost. The
trigger to reconsider is a dedicated platform engineer, not a scale number.

### IaC: Terraform (with Terragrunt if environments multiply)

**Rejected:** CDK (TypeScript IaC is appealing given our stack, but Terraform's state model, plan
output, and multi-provider support are better understood by the auditors and contractors we'll
inevitably work with), Pulumi (same reasoning, smaller ecosystem).

### CI/CD: GitHub Actions → ECS, with progressive delivery

**Pipeline:** lint + typecheck → unit → integration (ephemeral Postgres) → **tenancy isolation
suite** → **AI eval suite** (on any prompt/engine change) → build → deploy staging → smoke → canary
10% → full rollout.

The tenancy and eval gates are non-standard and non-negotiable. A prompt change is a production
change and goes through the same gate as code.

Database migrations are expand/contract only, always backward-compatible for one release, never
destructive in the same deploy as the code that stops using a column.

---

## 8. Observability

| Concern | Tool | Why |
|---|---|---|
| Errors | Sentry | Best-in-class triage; nothing else is close for this team size |
| Metrics + traces | OpenTelemetry → Grafana Cloud | Vendor-neutral instrumentation; avoids Datadog's cost trajectory while keeping the option to move |
| Logs | Structured JSON → Grafana Loki | Cheap, queryable, correlates with traces |
| Product analytics | PostHog (self-hosted initially) | Financial-adjacent behavioral data shouldn't go to a third party by default; self-hosting is credible in security reviews |
| LLM tracing | Braintrust or LangSmith | Prompt/response inspection, cost attribution, eval integration |
| Uptime | Better Stack | Boring and reliable |

**Rejected:** Datadog. Excellent product; the cost curve for a startup that instruments thoroughly is
punishing, and OTel keeps the migration path open if we outgrow Grafana.

**Domain-specific observability we must build ourselves** (nobody sells this):
- Forecast accuracy tracking — every forecast snapshotted and scored against actuals
- Answer-grounding violation rate — narrator attempts to emit an unslotted number
- Per-org token spend and margin, alerting on outliers
- Sync freshness and reconciliation divergence per connector

---

## 9. Testing

Full strategy in [testing.md](testing.md). Stack: Vitest (unit/integration), Playwright (E2E),
Testcontainers (real Postgres in CI), custom eval harness for the AI layer, Zod for runtime boundary
validation.

The unusual ones: **golden-fixture financial tests** (a synthetic business with hand-verified
correct answers for every metric, run on every commit) and the **adversarial tenancy suite**. These
two catch the failures that would actually end the company.

---

## 10. Summary table

| Layer | Choice | Primary rejected alternative | Decisive factor |
|---|---|---|---|
| Language | TypeScript (+ Python for models) | Python backend | Type safety across boundaries |
| Frontend | Next.js + React | Remix, SvelteKit | Streaming + RSC + hiring pool |
| Styling | Tailwind + Radix | MUI/Ant | Design differentiation |
| Charts | Visx | Recharts | Confidence bands, drill-down, custom design |
| API | tRPC (internal) + REST (public) | GraphQL | Type safety without codegen; deliberate public contract |
| Runtime | Node containers | Serverless | Streaming + connection pooling |
| DB | Postgres | Mongo, warehouse-first | RLS, NUMERIC, relational reality |
| ORM | Drizzle | Prisma | Doesn't fight raw SQL |
| Queue | BullMQ/Redis | Temporal | Operational simplicity now; trigger documented |
| AI | Claude + tiered routing | Single-model, no routing | Margin control + task fit |
| Vectors | pgvector | Pinecone | Small workload, one tenancy domain |
| Orchestration | Custom | LangChain | Correctness requires explicit control |
| Auth | WorkOS | Auth0, Clerk | Enterprise SSO path, pricing shape |
| Cloud | AWS | GCP | Trust and compliance ecosystem |
| Containers | ECS Fargate | Kubernetes | Ops cost vs. team size |
| IaC | Terraform | CDK, Pulumi | Ecosystem and auditor familiarity |
| Observability | OTel + Grafana + Sentry | Datadog | Cost curve, portability |
