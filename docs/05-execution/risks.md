# Risk Assessment

Ranked by **expected loss** (probability × impact), not by category. Each risk has an owner, a
mitigation, and a **tripwire** — an observable signal that means the risk is materializing and the
pre-agreed response should start.

Tripwires matter more than mitigations. Every startup has a risk register; few have agreed in advance
what evidence would change their behavior, which is why they notice too late.

---

## Tier 1 — Existential

### R1. A cross-tenant data leak
**Probability:** Low · **Impact:** Company-ending · **Owner:** Engineering

One customer seeing another's financials ends the company. In a financial product there is no
apology that recovers it, and disclosure is mandatory.

**Mitigation:** three independent layers — Postgres RLS with `FORCE`, typed tenant context that makes
an unscoped query unconstructible, and an adversarial CI suite that blocks with no override
([security §3](../03-engineering/security.md#3-tenant-isolation--the-control-that-matters-most)).
Verified fail-closed on missing context.

**Tripwire:** any RLS policy violation in logs — should be exactly zero. One occurrence is a P0
investigation, not a ticket.

**The subtle version of this risk:** the app is deployed with a database role that has `BYPASSRLS` or
owns the tables, which silently disables every policy while the schema still looks correct. This is
why the CI suite asserts role attributes before running its cases.

---

### R2. Confidently wrong numbers
**Probability:** Medium · **Impact:** Severe → existential at scale · **Owner:** Engineering/Product

A user finds one wrong number, and every other number becomes suspect permanently.

**Mitigation:** the model has no arithmetic authority; grounding violations are structurally caught;
golden fixtures assert exact equality; nightly reconciliation against source-system totals; every
figure drills to source.

**Tripwires:**
- Grounding violations > 0 in production → all feature work stops
- Reconciliation divergence on any connector → page
- Answer "incorrect" feedback rate > 3% → investigate the metric layer, not the prompt

**Note on the ordering:** R2 is *more likely* than R1 and nearly as damaging, but gets less attention
in most teams because it doesn't feel like a security issue. It should be treated as one.

---

### R3. Platform dependency — Intuit or Plaid restricts access
**Probability:** Low-Medium · **Impact:** Existential · **Owner:** Founders

Our product depends on API access from companies that may compete with us. Terms can change; access
can be revoked.

**Mitigation:** multi-source architecture so no single provider is load-bearing; CSV/PDF importer in
V1 as a genuine fallback ([integrations §5](../03-engineering/integrations.md#5-the-universal-fallback-csv-and-pdf-import));
direct relationships with both providers; app-marketplace presence that makes us a contributor rather
than a parasite; Xero as an accounting alternative.

**Tripwires:** developer-terms changes, rate-limit tightening, a competing first-party product
launch, or app-store review friction.

**Honest assessment:** partially mitigable, not eliminable. It belongs in the investor conversation
proactively ([fundraising §7](../04-business/fundraising.md#7-risks-stated-proactively)) — being
caught by it is worse than disclosing it.

---

## Tier 2 — Severe

### R4. The wedge is wrong — users don't retain
**Probability:** Medium · **Impact:** Severe · **Owner:** Product

Users try it, get value once, and stop. The default outcome for AI point tools.

**Mitigation:** lead with the recurring, high-stakes payroll alert rather than chat; the weekly brief
as an engineered habit loop; resolution confirmations that close loops; multi-user and accountant
access as retention correlates.

**Tripwires:**
- Weekly brief open rate < 40% among design partners at week 6 → **stop and rethink the wedge**
- Week-4 retention < 35% at month 12 → do not scale acquisition

This is the risk the roadmap's phase-1 kill criterion exists for
([roadmap](roadmap.md#phase-1--the-wedge-months-46)).

---

### R5. Real books are too messy to compute on
**Probability:** **High** · **Impact:** High · **Owner:** Product/Engineering

The most *likely* risk in this register. Real SMB books are frequently a mess: uncategorized
expenses, personal spending mixed in, unreconciled accounts, inconsistent charts of accounts.

**Mitigation:** detect and disclose rather than compute confidently on garbage; deliver what *is*
reliable and say what isn't; offer categorization assistance as a product feature
([onboarding §5](../01-product/onboarding.md#5-the-bad-books-problem)); bank data as a
corroborating source; the `messy-books` fixture in the test suite from sprint 3.

**Tripwire:** > 30% of connected businesses fall below a computed data-quality threshold →
categorization assistance becomes a top priority, not a nice-to-have.

**Why this deserves more attention than it usually gets:** it degrades every downstream output
simultaneously, it's invisible in demos on clean fixture data, and it's discovered late — right when
design partners are forming their opinion.

---

### R6. CAC exceeds sustainable levels
**Probability:** Medium-High · **Impact:** Severe · **Owner:** Founders/GTM

SMB fintech dies of CAC more often than of product.

**Mitigation:** accountant channel as the core strategy rather than a secondary segment; content/SEO
on question-intent keywords; no paid spend until retention gates are cleared; question-capture
funnel that converts before signup.

**Tripwires:** blended CAC > $500, or CAC payback > 12 months, sustained over a quarter.

---

### R7. Intuit ships a genuinely good AI CFO
**Probability:** Medium-High within 3 years · **Impact:** Severe · **Owner:** Founders

**Mitigation:** multi-source reconciliation they're structurally reluctant to build; the accountant
channel they're conflicted about disrupting; the forecast-accuracy flywheel that requires years of
outcome data; speed.

**Tripwire:** any Intuit announcement of AI-driven forecasting or advisory in QBO → accelerate the
firm channel, sharpen multi-source positioning, and open strategic conversations.

Full analysis in [competitive §5.1](../04-business/competitive-analysis.md#51-intuit-doing-this-properly).

---

## Tier 3 — Significant

### R8. Inference costs erode gross margin
**Probability:** Medium · **Impact:** Moderate · **Owner:** Engineering

**Mitigation:** tier routing (target ≥60% of calls on the fast tier), library plans, prompt caching,
batch API for reports, per-org token budgets.

**Tripwires:** COGS per Growth customer > $40/mo; fast-tier ratio < 50%; any single org's token spend
exceeding 10× the median.

**The specific danger is the tail, not the mean:** a handful of unbounded power users on an
"unlimited" plan can erase the margin on an entire cohort ([pricing §7](../04-business/pricing.md#7-cogs-and-gross-margin)).

### R9. Forecast accuracy never gets good enough
**Probability:** Medium · **Impact:** High · **Owner:** Engineering

If we can't beat ~10% MAPE at 30 days, the central claim and the moat both weaken.

**Mitigation:** structural rather than learned forecasting (explainable, no cold-start problem);
per-customer payment-lag modeling as the main accuracy driver; honest confidence bands; scoring from
day one so improvement is measurable.

**Tripwire:** 30-day MAPE > 12% at month 12 → widen published bands and re-examine the method rather
than continuing to claim accuracy we don't have.

### R10. Regulatory reclassification
**Probability:** Low · **Impact:** High · **Owner:** Founders/Legal

Being deemed to provide investment advice, tax advice, or credit services would change our
obligations materially.

**Mitigation:** advisory-only in V1, no money movement; explicit disclaimers on tax
([user-flows §12](../01-product/user-flows.md#flow-12--tax-set-aside)); the verifier's safety check
catches licensed-advice framing before it reaches a user; counsel review before any adjacent feature.

### R11. Key-person dependency
**Probability:** Medium · **Impact:** Moderate-High · **Owner:** Founders

Early teams concentrate critical knowledge, and the normalization/dedup logic here is unusually
subtle.

**Mitigation:** written architecture decisions (this repository), documented runbooks, no
single-owner critical systems past month 6, pair on the hardest subsystems.

### R12. Prompt injection via ingested data
**Probability:** Medium · **Impact:** Moderate · **Owner:** Engineering

Anyone who can invoice our customer can put text into our model's context.

**Mitigation:** structural — the model has no egress capability; all tool calls are tenant-scoped
before the model runs; ingested content is delimited as untrusted; output scanning as detection
([security §7](../03-engineering/security.md#7-ai-specific-security)).

The primary defense is architectural rather than filter-based, which is why it stays at tier 3
despite a medium probability.

### R13. Alert fatigue destroys the channel
**Probability:** Medium · **Impact:** Moderate · **Owner:** Product

If we cry wolf, users mute us, and the one alert that matters never lands.

**Mitigation:** hard false-positive budget (2/week), per-org materiality thresholds, feedback-driven
tuning, ranking with the remainder deferred to the weekly brief.

**Tripwire:** alert dismissal rate > 30%.

---

## Tier 4 — Monitored

| Risk | Note |
|---|---|
| Connector breakage at scale | Expected as normal operation; circuit breakers, DLQ, reconciliation |
| Model provider outage | Dashboard/alerts/forecasts don't depend on the LLM — degradation is graceful by design |
| Price point wrong | Defined test sequence ([pricing §8](../04-business/pricing.md#8-how-we-actually-test-price)) |
| Hiring in a competitive market | Architecture quality as a recruiting asset |
| Customer business failure (structural churn) | ~20%/yr assumed; controllable churn must compensate |
| Model behavior drift across versions | Eval suite gates every model change |

---

## The risks we're accepting deliberately

Not everything gets mitigated. These are conscious bets:

1. **Platform dependency on Intuit.** Unavoidable given the wedge. Hedged, not eliminated.
2. **Building on a rapidly-changing model landscape.** Provider abstraction limits lock-in; we accept
   ongoing eval maintenance as a cost of doing business.
3. **A narrow initial segment.** US services businesses on QuickBooks. Deliberately narrow — the
   alternative is a product that serves nobody particularly well.
4. **$249 pricing above the SMB comfort anchor.** Easier to discount than to raise.
5. **Advisory-only, foregoing action-based monetization.** Costs revenue opportunity; buys trust and
   a much smaller regulatory surface.

---

## Review cadence

- **Monthly:** tripwire check against actual metrics. Fifteen minutes; the point is noticing, not
  discussing.
- **Quarterly:** full register review, re-rank, retire what's passed, add what's emerged.
- **On any tripwire:** the pre-agreed response starts. The value of agreeing in advance is that the
  decision isn't made under pressure by whoever is loudest.
