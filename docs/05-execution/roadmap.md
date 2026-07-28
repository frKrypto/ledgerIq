# Development Roadmap

18 months, four phases. **Every phase has a kill criterion** — a result that should stop us and force
a rethink rather than a push onward. Phases without kill criteria are wishes.

---

## Phase 0 — Foundation (months 1–3)

**Goal:** the data pipeline and metric engine work correctly. No UI beyond what's needed to verify.

**Build order — this order specifically:**

1. Canonical schema + RLS + the adversarial tenancy suite
2. QuickBooks Online connector: OAuth, full backfill, incremental sync, raw archive
3. Normalization: canonical mapping, dedup, transfer matching, entity resolution
4. Plaid connector
5. Metric engine: catalog framework, ~25 core metrics, provenance
6. Golden fixture businesses + the exact-equality test suite
7. Minimal internal UI to inspect a business's computed metrics

**Why UI comes last:** every metric bug found after a UI exists is 5× more expensive, because the UI
encodes assumptions about the data. Build the correct foundation, verify it exhaustively, then put a
face on it.

**Exit criteria**
- Golden fixtures 100% exact-match across all fixture businesses
- Tenancy suite green and blocking in CI
- A real business's QuickBooks + bank data reconciles to source-system totals
- Nightly reconciliation sweep detects deliberately injected divergence

**Kill criterion:** if after 3 months we cannot make a real business's data reconcile to its
QuickBooks totals, the normalization problem is harder than scoped and the timeline is wrong.
Reassess before building anything on top.

---

## Phase 1 — The wedge (months 4–6)

**Goal:** cash-flow certainty, in front of design partners.

- Forecast engine: four-stream decomposition, Monte Carlo bands, per-customer payment-lag modeling
- **Forecast scoring from the very first forecast** — the flywheel table starts accumulating now
- Payroll-risk and cash-shortfall alert rules with the materiality/false-positive framework
- Alert delivery: in-app, email, SMS for critical
- Weekly brief generation and delivery
- Onboarding: connect flow, progressive reveal, chart-of-accounts confirmation
- Minimal dashboard: cash, runway, forecast chart
- Stripe connector

**Exit criteria**
- 15+ design partners connected and receiving weekly briefs
- Payroll risk correctly detected on at least 3 real businesses
- Weekly brief open rate >50% among design partners
- Forecast accuracy being measured (accuracy itself will still be poor — that's expected)

**Kill criterion:** if design partners stop opening the weekly brief by week 6, the wedge is wrong.
That's a product-thesis failure, not a marketing one, and no amount of feature work fixes it. Stop
and re-examine [PRD §2.1](../01-product/prd.md#21-the-wedge).

---

## Phase 2 — The intelligence (months 7–12)

**Goal:** the full AI CFO, and the first paying customers.

- **The reasoning pipeline**: classifier → planner → executor → narrator → verifier
- Answer contract rendering, drill-down, assumption editing
- Eval harness, all four tiers; human review process staffed
- Question coverage for the seven families in [PRD §5.1](../01-product/prd.md#51-ai-cfo-chat)
- Scenario planning: the 10-scenario library, assumption editing, comparison
- Business health score with self-comparison (benchmarking gated until cohort depth)
- Full metric suite, decomposition, customer profitability
- Full dashboard, full report suite
- Billing, plans, self-serve signup
- CSV/PDF importer (also the platform-risk hedge)
- SOC 2 Type I

**Exit criteria**
- Grounding violations at zero in production
- >80% of answers rated helpful
- 100+ paying businesses
- Week-4 retention >45%
- 30-day forecast MAPE <12%

**Kill criterion:** if week-4 retention is below 35% at month 12, the product is a toy. Do not scale
acquisition; return to the wedge.

---

## Phase 3 — The channel (months 13–18)

**Goal:** distribution leverage and the flywheel becoming visible.

- Firm tier: multi-client console, attention ranking, white-label reports, bulk generation
- Firm onboarding and partner support tooling
- Benchmarking, once cohorts reach 30+ businesses per NAICS × revenue-band cell
- Residual-correction modeling on the forecast, using accumulated outcome data
- Gusto and Xero connectors
- Public API + OpenAPI, QuickBooks App Store listing
- SSO/SAML, advanced RBAC
- SOC 2 Type II
- Content engine at scale

**Exit criteria**
- 15+ firm partnerships, 600+ businesses
- $1.5M+ ARR, NRR >110%
- 30-day forecast MAPE <8%, and **demonstrably better for longer-tenured cohorts**
- CAC payback <12 months

**Kill criterion:** if firms won't adopt after 15+ serious conversations, the channel thesis is wrong
and the GTM plan needs rebuilding around direct acquisition — with the much worse economics that
implies.

That last exit criterion — accuracy improving with tenure — is the one that matters most
strategically. It's the flywheel showing up as evidence rather than assertion, and it's the Series A
proof point ([fundraising §4](../04-business/fundraising.md#4-traction-narrative-by-stage)).

---

## Beyond 18 months — direction, not commitment

**Phase 4 (18–30 months):** commerce and spend connectors, multi-entity, deeper tax planning,
industry-specific packs, mobile app, international (Xero-led).

**Phase 5 (30+ months):** the shift from advisory to operational — cash optimization, fraud
detection, automated financing preparation, and eventually permissioned actions with
human-in-the-loop. Each step requires trust we won't have earned until accuracy is proven and
published.

Anything beyond month 18 is a direction, not a plan. Writing detailed roadmaps two years out is a
way of feeling organized rather than being right.

---

## Sequencing principles

These explain the ordering above and should govern re-planning when reality intervenes:

1. **Correctness before capability.** The metric engine before the AI. Non-negotiable.
2. **The wedge before the platform.** Payroll risk before scenario planning, even though scenarios
   demo better.
3. **Instrument before you need it.** Forecast scoring from day one, though it pays off in year two.
4. **Retention before acquisition.** No paid spend until week-4 retention clears its gate.
5. **Depth before breadth.** Three connectors done properly beats twelve done partially.
6. **Trust infrastructure is not deferrable.** Tenancy isolation, audit logging, and drill-down are
   phase 0 concerns, not phase 3 cleanup.

---

## What we are explicitly not doing in 18 months

Stated so it doesn't get relitigated every quarter: our own general ledger, money movement, tax
filing, lending, a native mobile app, 14 of the 17 originally-listed integrations, multi-currency,
and non-English localization.

Each has a real argument for it. None is the wedge. See
[PRD §2.2](../01-product/prd.md#22-what-we-are-explicitly-not-building-v1).

---

## Team plan

| Phase | Team | Notes |
|---|---|---|
| 0 | 2 founders + 1 backend engineer | Data-heavy; hire for correctness instincts |
| 1 | +1 full-stack, +1 designer | UI begins |
| 2 | +1 AI/ML engineer | Owns reasoning + evals |
| 3 | +1 partnerships, +1 support | Channel motion |
| End of 18mo | ~9 people | |

**The first engineering hire should be a data engineer, not a full-stack generalist.** The hardest
and highest-risk work in year one is normalization and reconciliation, and hiring for the visible
part of the product first is the most common sequencing mistake in this kind of company.
