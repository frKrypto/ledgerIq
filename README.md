# LedgerIQ

**An AI CFO for small and medium businesses.** Business owners ask questions in plain English —
_"Can I afford to hire?"_, _"Will I make payroll?"_, _"Where am I leaking money?"_ — and get
answers computed from their real financial data, with the reasoning, assumptions, and confidence
shown.

This repository holds the founding plan: product, architecture, design, business, and execution.

---

## The one-paragraph thesis

Every SMB has financial data spread across QuickBooks, a bank, Stripe, and a payroll provider. None
of them answer the questions owners actually have, because answering those questions requires
synthesis plus judgment — which is what a CFO does, and why a CFO costs $200K/yr. Fractional CFOs
cost $3–8K/mo and don't scale below ~$2M revenue. That leaves millions of US businesses with real
financial complexity and no financial brain. LedgerIQ is that brain, at $99–$499/mo, built on a
deterministic finance engine that an LLM reasons *over* rather than *instead of*.

## The non-obvious bets

These are the decisions the whole plan rests on. Each is argued in detail in the linked doc.

| # | Bet | Why it's contrarian | Where argued |
|---|-----|---------------------|--------------|
| 1 | **The LLM never does arithmetic.** A deterministic metric engine computes every number; the model plans queries and narrates results. | Most AI-finance demos pipe a CSV into a context window. That is unshippable — one wrong number destroys trust permanently. | [AI CFO Engine](docs/03-engineering/ai-cfo-engine.md) |
| 2 | **Chat is the demo, not the product.** Alerts + the weekly brief are the retention loop. | Everyone is building the chat box. Chat has poor standalone retention — users ask five questions in week 1 and none in week 4. | [PRD §3](docs/01-product/prd.md) |
| 3 | **Wedge on cash-flow certainty, not "insights."** Ship payroll-risk and runway first. | "Insights" is unfalsifiable and unpriceable. "You will be $14K short on Nov 15" is neither. | [PRD §2](docs/01-product/prd.md), [GTM](docs/04-business/go-to-market.md) |
| 4 | **Accounting firms are the distribution unlock,** not just a secondary segment. | Direct SMB SaaS CAC is brutal. One firm brings 40–200 clients with a warm intro and pre-cleaned books. | [GTM §4](docs/04-business/go-to-market.md) |
| 5 | **Build 3 integrations, not 17.** QuickBooks + Plaid + Stripe covers the large majority of target-segment data. | Integration count is a vanity metric that can eat the first year of engineering. | [Integration Strategy](docs/03-engineering/integrations.md) |
| 6 | **Own the semantic layer, not the ledger — at first.** Long-term defensibility comes from the forecast-accuracy flywheel, not from replacing QuickBooks. | "Replace QuickBooks" is a decade-long, capital-intensive project that kills seed-stage companies. | [Architecture §2](docs/03-engineering/architecture.md) |

## Document index

### Product
- **[Product Requirements Document](docs/01-product/prd.md)** — segments, jobs-to-be-done, full feature specs, non-goals, success metrics
- **[User Flows](docs/01-product/user-flows.md)** — end-to-end flows including the critical question→answer→action loop
- **[Onboarding](docs/01-product/onboarding.md)** — the path from signup to first true insight, and why it's the hardest problem in the product
- **[Feature Prioritization](docs/01-product/feature-prioritization.md)** — RICE-scored backlog with an explicit cut list

### Design
- **[Brand Identity](docs/02-design/brand-identity.md)** — positioning, voice, naming, visual direction
- **[Design System](docs/02-design/design-system.md)** — tokens, type scale, components, data-viz rules, accessibility
- **[Wireframes & UI Concepts](docs/02-design/wireframes.md)** — annotated low-fi layouts for all core surfaces
- **[High-fidelity prototype](docs/02-design/ui-concept.html)** — interactive single-file mockup

### Engineering
- **[Technical Architecture](docs/03-engineering/architecture.md)** — system design, data flow, service boundaries, scaling plan
- **[Tech Stack Evaluation](docs/03-engineering/tech-stack.md)** — every choice with the rejected alternatives and the tradeoff
- **[AI CFO Engine](docs/03-engineering/ai-cfo-engine.md)** — the core IP: planner/executor/narrator, grounding, evals, hallucination defense
- **[Database Schema](docs/03-engineering/database-schema.md)** · [DDL](docs/03-engineering/schema/schema.sql)
- **[API Specification](docs/03-engineering/api-spec.md)** · [OpenAPI](docs/03-engineering/schema/openapi.yaml)
- **[Integration Strategy](docs/03-engineering/integrations.md)** — sequencing, the normalization problem, cost of each connector
- **[Security Architecture](docs/03-engineering/security.md)** — threat model, encryption, tenancy isolation, RBAC, audit
- **[Deployment & Infrastructure](docs/03-engineering/deployment.md)** — environments, IaC, CI/CD, DR, cost model
- **[Testing & Quality](docs/03-engineering/testing.md)** — including how you test a non-deterministic product

### Business
- **[Competitive Analysis](docs/04-business/competitive-analysis.md)** — the real competitors, including the two that could kill us
- **[Pricing & Monetization](docs/04-business/pricing.md)** — packaging, price testing plan, gross-margin model under LLM costs
- **[Go-to-Market](docs/04-business/go-to-market.md)** — sequenced motions, CAC/payback targets, the accountant channel
- **[Marketing Strategy](docs/04-business/marketing.md)** — positioning, content engine, demand gen
- **[Fundraising Narrative](docs/04-business/fundraising.md)** — the story, the market math, objection handling
- **[Investor Pitch](docs/04-business/pitch-deck.md)** — slide-by-slide outline with speaker notes

### Execution
- **[Development Roadmap](docs/05-execution/roadmap.md)** — 18 months, 4 phases, with kill criteria per phase
- **[Sprint Plan](docs/05-execution/sprint-plan.md)** — sprints 1–12 in detail, with acceptance criteria
- **[Risk Assessment](docs/05-execution/risks.md)** — ranked by expected loss, with mitigations and tripwires
- **[Compliance Roadmap](docs/05-execution/compliance.md)** — SOC 2, GLBA, state privacy law, and what *not* to chase early
- **[Analytics Plan](docs/05-execution/analytics.md)** — the event taxonomy and the four metrics that actually matter

## Reading order

- **Founder / investor:** Thesis above → [PRD §1–3](docs/01-product/prd.md) → [Competitive](docs/04-business/competitive-analysis.md) → [Fundraising](docs/04-business/fundraising.md)
- **First engineer:** [Architecture](docs/03-engineering/architecture.md) → [AI CFO Engine](docs/03-engineering/ai-cfo-engine.md) → [Schema](docs/03-engineering/database-schema.md) → [Sprint Plan](docs/05-execution/sprint-plan.md)
- **First designer:** [Brand](docs/02-design/brand-identity.md) → [Design System](docs/02-design/design-system.md) → [Wireframes](docs/02-design/wireframes.md) → [Onboarding](docs/01-product/onboarding.md)

## A note on the numbers in these documents

Market sizing, benchmark conversion rates, competitor pricing, and cost models are **planning
estimates built from public knowledge and stated assumptions, not researched figures**. They are
written to be falsifiable: each carries its assumption inline so it can be replaced with real data.
Before any of this goes in front of an investor, the figures marked _[verify]_ need primary
sourcing. Treat them as a model to argue with, not facts to cite.

## Status

**Sprints 1–2 complete.** The tenancy spine and the QuickBooks ingestion pipeline are built and
tested; there is no user-facing product yet and won't be until roughly sprint 7 — see
[the sprint plan](docs/05-execution/sprint-plan.md).

| Delivered | Where |
|---|---|
| Monorepo, TypeScript strict, CI pipeline | `package.json`, `.github/workflows/ci.yml` |
| Money type — integer minor units, never float | `packages/core/src/money.ts` |
| Core schema + RLS migrations | `packages/db/migrations/` |
| Typed tenant context — unscoped queries don't compile | `packages/db/src/tenant-context.ts` |
| **Adversarial tenancy suite (blocks CI, no override)** | `packages/db/test/tenancy.test.ts` |
| Terraform database module with the app-role security control | `infra/modules/database/` |
| Per-tenant envelope encryption (AES-256-GCM under a KMS root key) | `packages/crypto/` |
| Rate-limited HTTP client: 429/Retry-After, jittered backoff, circuit breaker | `packages/connectors/src/http.ts` |
| Immutable raw-payload archive with content-addressed dedup | `packages/connectors/src/archive.ts` |
| QuickBooks adapter: OAuth, rotating refresh tokens, paginated sync | `packages/connectors/src/quickbooks/` |
| **Resumable backfill — archive-then-checkpoint ordering** | `packages/connectors/src/sync/backfill.ts` |
| Credential vault proving a database dump yields no usable tokens | `packages/db/src/repositories/credentials.ts` |

```bash
npm install && docker compose up -d postgres
npm run db:migrate && npm test        # 97 tests
```

Verified, not assumed: the isolation suite was mutation-tested — removing `FORCE ROW LEVEL
SECURITY` and changing the tenant scope from transaction-local to session-local each turn it red.
Developer guide and the three non-negotiable rules: [CONTRIBUTING.md](CONTRIBUTING.md).

Sprint 2 is tested against a **fake QuickBooks server** that reproduces the real API's quirks —
1-indexed pagination, omitted entity arrays at end-of-results, rotating refresh tokens, 429s with
`Retry-After`, and mid-stream token expiry. That server caught a real bug: QBO stamps every response
with a timestamp, so hashing the whole payload made re-fetched pages look unique and silently
defeated deduplication on the retry path.

**Next:** sprint 3 — normalization into the canonical model, and the chart-of-accounts mapping.
