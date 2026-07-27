# Sprint Plan — Sprints 1–12

Two-week sprints covering months 1–6 (roadmap phases 0 and 1). Beyond sprint 12, plan a quarter
ahead; detailed sprint plans further out are fiction.

**Team assumption:** 2 founders + 1 backend engineer through sprint 6, +1 full-stack and +1 designer
from sprint 7.

Each sprint states acceptance criteria in terms of *demonstrable behavior*, not tickets closed.

---

## Sprint 1 — Skeleton and tenancy

**Goal:** an empty application that is already impossible to leak data from.

- Monorepo, TypeScript, Drizzle, Postgres via Testcontainers, CI pipeline
- Core schema: `organizations`, `users`, `memberships`, `connections`
- **RLS policies on every tenant table, with `FORCE`**
- Typed tenant context in the data-access layer — no query constructible without one
- **Adversarial tenancy suite**, blocking in CI
- Terraform skeleton: VPC, RDS, ECS, secrets
- WorkOS auth, MFA enrollment

**Acceptance**
- Tenancy suite passes and asserts the app role is `NOSUPERUSER`/`NOBYPASSRLS` before running cases
- A query with no tenant context returns zero rows, verified in a test
- CI runs on every PR and blocks on the tenancy suite

**Why first:** retrofitting tenant isolation is a rewrite. It costs a week now and a quarter later.

---

## Sprint 2 — QuickBooks: connect and land raw data

- QBO OAuth flow, token storage with per-tenant envelope encryption, refresh handling
- Raw payload archive to S3 with content hashing and object lock
- `sync_runs` tracking, BullMQ job infrastructure
- Full backfill of 24 months, resumable and rate-limit aware
- Connection status model and the `reauth_required` state

**Acceptance**
- Connect a real QuickBooks account and land 24 months of raw payloads
- Kill the process mid-backfill; it resumes without duplication or gaps
- Token refresh works across an expiry boundary

---

## Sprint 3 — Normalization I: the canonical model

- Canonical mapping: QBO accounts, transactions, invoices, bills, customers, vendors
- Chart-of-accounts → canonical category mapping, with an LLM-assisted one-time pass and a
  human-confirmation queue
- Lineage capture on every canonical record
- Golden fixture businesses: `agency-22` and `messy-books`

**Acceptance**
- A fixture's QBO data produces a canonical dataset that reconciles to source P&L totals
- Every canonical record traces to its raw payload
- `messy-books` surfaces its categorization gaps rather than silently mis-mapping them

---

## Sprint 4 — Plaid, dedup, and transfer matching

- Plaid connector: link flow, accounts, transactions, balances, re-auth handling
- Daily balance history backfill
- **Deduplication** across sources: candidate search, matching heuristics, canonical/mirror marking
- **Transfer matching** with pair linking
- Merchant name normalization
- Nightly reconciliation sweep with divergence alerting

**Acceptance**
- A Stripe payout appearing in bank + QBO is counted exactly once
- Internal transfers do not affect revenue or expense — property test asserts this over arbitrary
  transaction sets
- Reconciliation sweep detects a deliberately injected divergence and alerts

**Risk note:** this is the hardest sprint in the plan. Dedup and transfer matching are where
correctness is won or lost, and where a naive implementation produces confidently wrong numbers.
Budget for it running long; do not compress it to protect the schedule.

---

## Sprint 5 — Metric engine

- Metric catalog framework: typed definitions, declared data requirements, provenance, versioning
- ~25 core metrics: revenue, COGS, gross margin, net profit, opex by category, burn, runway, cash
  position, AR aging, DSO, AP due, customer revenue, revenue concentration
- Period math: fiscal-year awareness, comparisons, trailing windows
- `metric_snapshots` materialization with invalidation on data change
- Decomposition framework — ranked drivers of change between periods

**Acceptance**
- Golden fixtures: **exact equality** on all 25 metrics across all fixture businesses
- Fiscal-year-offset business computes annual metrics correctly
- Every metric result carries drill-down-capable provenance
- Metrics with unmet data requirements return `insufficient_data`, never zero

---

## Sprint 6 — Forecast engine

- Four-stream decomposition: committed, receivables, variable, new revenue
- **Per-customer payment-lag distribution fitting**
- Seasonal decomposition for variable spend, with a thin-history fallback
- Monte Carlo composition → P10/P50/P90
- Risk-event detection: payroll shortfall, cash shortfall, tax obligation, large expense
- **`forecast_scores` scoring job — from the very first forecast**
- Cold-start behavior: wide bands, explicit low confidence, no refusal

**Acceptance**
- 13-week daily forecast for all fixtures, with ordered bands (property-tested)
- Payroll shortfall correctly detected in a fixture engineered to have one
- `thin-history` fixture produces a wide band and low confidence rather than a confident line
- Every forecast is snapshotted and scheduled for scoring

---

## Sprint 7 — Onboarding *(+ designer, + full-stack)*

- Landing page with question capture
- Signup, business profile, MFA enforcement
- Connect flows with the trust panel
- **Progressive reveal during sync** — true facts at 30s / 90s / 3min / 5min
- Chart-of-accounts confirmation UI (ambiguous items only)
- Demo mode on a sample business
- Disqualification path

**Acceptance**
- Signup → first true fact in under 6 minutes on a real account
- Every funnel step instrumented per [onboarding §4](../01-product/onboarding.md#4-activation)
- Declining to connect lands in demo mode, not a dead end

---

## Sprint 8 — Alerts and the weekly brief

- Alert rule framework with per-org materiality thresholds
- Payroll risk, cash shortfall, tax obligation, large expense rules
- **False-positive budget**: max 2/week, critical bypass, ranking, dedup keys
- Delivery: in-app, email, SMS for critical
- Feedback loop tuning thresholds
- **Weekly brief** generation and Monday delivery, with open/click tracking
- Resolution confirmation when a flagged risk clears

**Acceptance**
- Alerts respect the cap; critical bypasses it
- A dismissed alert does not re-fire on the same condition
- Weekly brief renders correctly in Gmail, Outlook, and Apple Mail
- Resolution confirmation fires when a payroll gap closes

---

## Sprint 9 — Dashboard and drill-down

- App shell, nav, freshness indicator
- Home: answer bar, four stat tiles, forecast chart
- **Forecast chart** with band, actual/projected boundary, risk markers, payroll floor rule
- **Drill-down from any figure to source transactions**
- Transactions view with filtering
- Business-model-adaptive metric display
- Empty and degraded states

**Acceptance**
- Every figure on the dashboard drills to source records
- A services business does not see MRR/CAC/LTV
- Stale connection renders a visible freshness state, not a silent number
- P95 dashboard load under 1.5s

---

## Sprint 10 — Reasoning pipeline I

- Provider abstraction, tiered routing, token accounting
- Classifier: family, entities, period, data requirements, complexity
- Planner: typed `AnalysisPlan`, validation, retry-with-error
- Executor: parallel metric calls, compute budget, coverage checks
- **Slot-based narration** and rendering
- **Verifier**: grounding scan, contract validation, directional checks, safety
- `answer_traces` persistence

**Acceptance**
- **Zero grounding violations** across the fixture question set
- An out-of-scope question is declined honestly, not answered
- A question needing unconnected data returns the connect prompt
- Every answer persists a replayable trace

---

## Sprint 11 — Reasoning pipeline II and evals

- Question coverage across all seven families
- Streaming with staged progress events
- Assumption surfacing and editing with live recompute
- Follow-up suggestions
- **Eval harness, tiers 1–3**; human review process defined and staffed
- Answer feedback → eval candidate triage pipeline
- Library plans for the most common question shapes

**Acceptance**
- Eval suite runs in CI and blocks prompt changes on regression
- P95 answer latency under 12s
- ≥60% of model calls land on the fast tier
- Editing an assumption recomputes and re-renders the answer

---

## Sprint 12 — Scenarios and design-partner hardening

- Scenario engine: hire, price change, lose customer, purchase, loan
- Fully-loaded cost modeling, ramp, **conservative default assumptions**
- Base-vs-scenario comparison, break-even, largest risk
- Scenario save, compare, export
- Bug burn-down from design-partner feedback
- Connector resilience: chaos cases, circuit breakers, DLQ replay

**Acceptance**
- Hire scenario produces a defensible fully-loaded number a CFO would agree with
- Every assumption is editable and recomputes live
- Revenue lift defaults to zero, with the reasoning shown
- Design partners can complete all core flows without founder intervention

---

## Working practices

- **Two-week sprints**, demo on the last day to at least one design partner
- **Definition of done** per [testing §7](../03-engineering/testing.md#7-definition-of-done) —
  including instrumentation and degradation behavior
- **20% of each sprint reserved** for bugs, support, and reduction of accumulated shortcuts. Not
  optional; the first sprint that spends it on features starts the debt spiral.
- **No sprint ships with the tenancy or golden-fixture suites red.** There is no deadline that
  justifies it, so the tooling offers no override.
- **Design-partner feedback is triaged weekly**, not batched into a quarterly review.

## The three sprints most likely to slip

Stated up front so slippage is a known risk rather than a surprise:

1. **Sprint 4 (dedup and transfers)** — genuinely hard, and correctness here is load-bearing for
   everything downstream.
2. **Sprint 6 (forecast)** — the payment-lag modeling has more edge cases than it appears to.
3. **Sprint 10 (reasoning)** — getting grounding violations to actual zero, rather than nearly zero,
   is the long tail.

If any slips, take the time. The alternative is shipping a product that produces confident wrong
numbers, which is worse than shipping late.
