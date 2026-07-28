# Fundraising Narrative

> Market sizing below is **built from stated assumptions, not researched data**. Every figure marked
> _[verify]_ needs primary sourcing (Census/SUSB for business counts, competitor filings, analyst
> reports) before it goes in front of an investor. A sizing slide that falls apart under one question
> costs more credibility than a smaller, defensible number.

---

## 1. The narrative

### The one-liner

> **LedgerIQ is an AI CFO for small businesses — we answer the financial questions owners actually
> have, computed from their real data.**

### The three-sentence version

> Six million US businesses are too big to run on gut feel and too small to afford a CFO. Their data
> already exists across QuickBooks, their bank, and Stripe — but nothing turns it into an answer to
> "can I afford to hire?" We built a deterministic financial engine that an AI reasons over, so every
> answer is exact, traceable to source transactions, and actionable.

### The arc, in the order it should be told

1. **The gap is structural.** Financial complexity arrives long before a business can afford
   financial expertise. There's a decade-long window where owners make consequential decisions with
   no analytical support.
2. **The data already exists.** This isn't a data-collection problem. It's a synthesis-and-judgment
   problem — which is exactly what became tractable in the last two years.
3. **But naive AI fails catastrophically here.** One wrong number ends the relationship permanently.
   Most entrants pipe transactions into a context window; that cannot be made reliable.
4. **So we built it the other way around.** A deterministic metric engine computes; the model plans
   and narrates. The model has no arithmetic authority — enforced structurally, not by prompting.
5. **The wedge is cash-flow certainty.** We tell you about the payroll problem three weeks early.
   Falsifiable, high-stakes, recurring — it creates dependency in a way a chat box doesn't.
6. **Distribution is the accountant channel.** One firm brings 40–200 businesses with clean books and
   a warm introduction, at a fraction of direct SMB CAC.
7. **The moat is a forecast-accuracy flywheel.** Every forecast we've ever made is scored against
   what actually happened. That dataset compounds, can't be bought, and makes the product measurably
   better with scale.
8. **The end state** is the financial operating system for small business — starting with answers,
   moving toward autonomous financial operations.

---

## 2. Why now

Three things converged, and none was true five years ago:

1. **Model capability.** Reliable multi-step analytical planning and plain-language causal
   explanation crossed the usability threshold around 2023.
2. **Inference economics.** Cost per complex answer fell enough to support 90% gross margin at a
   $249/mo subscription ([pricing §7](pricing.md#7-cogs-and-gross-margin)).
3. **Data accessibility.** QuickBooks, Xero, and Plaid APIs are mature and stable enough to build a
   dependent business on.

Plus a demand-side shift: SMB owners now expect to type a question and get an answer. The interaction
model requires zero education — historically the biggest adoption barrier in this category.

---

## 3. Market sizing

**Built bottom-up, because top-down sizing invites the "why do you only need 1%?" question.**

_[verify: all business counts against Census SUSB data]_

| Segment | US businesses | Rationale |
|---|---|---|
| Employer businesses, 5–500 employees | ~2.5M | Enough complexity to need this |
| …with $500K–$50M revenue | ~1.8M | Can afford $99–599/mo |
| …using QuickBooks or Xero | ~1.1M | Our data requirement today |
| **Serviceable obtainable (SOM)** | **~1.1M** | |

- **SAM** at $249/mo blended ARPU: 1.1M × $3,000/yr ≈ **$3.3B/yr**
- **TAM** including international, larger businesses, and the firm tier: **$8–12B**
- **Beachhead:** US services businesses, 10–50 employees, QuickBooks, $1–10M revenue ≈ **220K
  businesses ≈ $660M**

**A defensible near-term target:** 10,000 businesses at $249/mo ≈ **$30M ARR**, roughly 0.9% of SAM.

The credibility move is to present the *beachhead* as the primary number and the TAM as context, not
the reverse. Investors have seen enough $50B TAM slides to discount them automatically.

---

## 4. Traction narrative by stage

**Pre-seed / seed (now):** the story is the team, the architectural insight, and design-partner
signal. The proof point that matters is a live demo on a real business's data — connect QuickBooks,
ask a question, click the number, see the transactions.

**Seed metrics to show:** 15–25 design partners, week-4 retention >45%, forecast accuracy measured
from day one, 3 case studies with specific saves.

**Series A (18–24 months):** $1.5–3M ARR, 600–1,200 businesses, 15+ firm partnerships, NRR >110%,
CAC payback <12 months, published forecast accuracy improving with cohort tenure.

**The A-round proof point is the flywheel showing up in data:** forecast accuracy demonstrably better
for businesses with longer tenure and for cohorts in industries where we have more customers. If that
curve is real and visible, the moat argument becomes evidence rather than assertion.

---

## 5. The ask

**Seed: $3.5M for 24 months of runway.**

| Use | Share | Detail |
|---|---|---|
| Engineering | 55% | 4 engineers — 2 backend/data, 1 AI/ML, 1 full-stack |
| Product & design | 15% | 1 designer, founder-led product |
| GTM | 18% | 1 partnerships/accountant-channel hire, content |
| Infrastructure & tools | 7% | Including inference costs |
| Compliance & legal | 5% | SOC 2, privacy counsel |

**Milestones this buys:**
- Product live with the three launch integrations
- 500+ paying businesses
- 15+ firm partnerships
- SOC 2 Type II complete
- Published forecast accuracy with 18 months of scored history
- $1.5M+ ARR → Series A ready

---

## 6. Objection handling

The honest answers. Rehearsed evasions on these are transparent and cost more than the objection.

### "Won't Intuit just build this?"

*They might, and we plan for it.* Three reasons we can still win: their answers come only from their
own ledger, while the valuable answers require reconciling the GL against the bank against Stripe;
their advisory channel is a large revenue stream that this product disrupts, which is a real internal
conflict; and large-company AI ships generically. We also build the accountant relationship they're
conflicted about disrupting. Full analysis in
[competitive §5.1](competitive-analysis.md#51-intuit-doing-this-properly).

### "How is this different from the dozen other AI CFO startups?"

*Most let the model touch the numbers.* Ours structurally cannot — a deterministic engine computes,
the model narrates over verified values, and any bare numeral in model output is a caught error, not
a shipped one. Ask any competitor's product a numeric question and try to click the number. Second:
we lead with the payroll alert, not the chat box, because chat has poor standalone retention.

### "What if the AI is wrong? Isn't that a liability?"

*That's why the architecture is what it is.* The model can't produce a number. Every figure traces to
source transactions. Confidence is computed from data depth, not asserted by the model. We're
advisory, not fiduciary, with clear boundaries on tax and legal advice. And we publish our own
forecast accuracy — which is not something you do unless you're measuring it.

### "SMB SaaS has terrible churn and CAC."

*Correct, and it's why the plan leads with the accountant channel.* Direct SMB CAC at a $249 ACV is
punishing. One firm brings 40–200 businesses with clean books and a warm introduction. On churn: some
is structural — customers' businesses fail — so we're explicit that controllable churn must be very
low, and the weekly brief plus proactive alerts are engineered specifically as the retention
mechanism.

### "Why won't they just churn after the first insight?"

*Because the wedge is recurring, not one-time.* Payroll happens every two weeks. Taxes every quarter.
The alert that saves them in month 1 is a different alert in month 4. That's why we chose cash-flow
certainty over one-shot "insights."

### "Is this a feature, not a company?"

*It's a feature if you define it as a chat box.* Defined properly it's a semantic layer over
fragmented financial data plus a forecasting engine that improves with fleet scale. That's
infrastructure, and the accumulated forecast-outcome dataset can't be replicated by a competitor
starting later.

### "What's the moat?"

*Not the integrations — those are commodity.* It's the forecast-accuracy flywheel: every forecast
scored against actuals, accumulating into per-industry payment-behavior priors and residual
corrections that a new entrant cannot buy. Plus the accountant channel, which is relationship-based
and slow to displace. Full mechanism in
[ai-cfo-engine §8](../03-engineering/ai-cfo-engine.md#8-the-forecast-accuracy-flywheel).

---

## 7. Risks, stated proactively

Volunteering these is a credibility asset, not a liability. An investor who finds them later
discounts everything else in the deck.

| Risk | Our answer |
|---|---|
| Platform dependency on Intuit/Plaid | Real and material. Multi-source from day one, CSV/PDF fallback in V1, direct bank relationships long-term. |
| Data quality in real books | The single biggest product risk. We detect and disclose rather than compute confidently on garbage ([onboarding §5](../01-product/onboarding.md#5-the-bad-books-problem)). |
| Price sensitivity at $249 | The highest-variance assumption in the plan, with a defined test sequence ([pricing §8](pricing.md#8-how-we-actually-test-price)). |
| Inference cost trajectory | Managed by tier routing; tracked as an engineering metric. Costs have trended down, but we don't depend on that. |
| Trust incident | One cross-tenant leak or one badly wrong number is existential. It's why the tenancy suite blocks CI with no override. |
| Long sales cycle with firms | Mitigated by starting with fractional CFOs rather than large firms. |

Full ranked assessment: [risks.md](../05-execution/risks.md).

---

## 8. The team story

*(To be completed with actual backgrounds.)* The three questions investors are really asking:

1. **Why you?** Ideally: someone who has lived the problem (operator/CFO in an SMB) plus someone who
   has built reliable data systems at scale. The domain half matters more than usual here — knowing
   *which* questions matter and how books actually break is not learnable from a spec.
2. **Can you build it?** The architecture in this repository is the artifact that answers this. It
   demonstrates that we understand why the naive version fails.
3. **Can you sell it?** The accountant-channel insight is the answer, and it should be evidenced by
   real conversations with firms before the raise.

---

## 9. The long-term story

Investors fund the ten-year version. Ours:

**Years 1–2 — Answers.** Reliable answers to the questions that matter. Establish trust and the
accuracy flywheel.

**Years 3–5 — Guidance.** Proactive rather than reactive. The product notices, recommends, and
models. Benchmarking makes advice contextual: not just "your margin fell" but "your margin fell while
comparable businesses' rose."

**Years 5–10 — Operations.** With trust established and accuracy proven, the product begins acting
with permission: managing cash across accounts, timing payments to optimize position, flagging fraud
in real time, preparing financing packages automatically.

**The end state:** the financial operating system for small business — the layer through which owners
understand and eventually run their finances. That's a category-defining position, and it's reachable
only by earning trust first, one correct answer at a time.

The honest framing for the room: *we are building years 1–2 with the architecture that makes years
5–10 possible.* Nobody gets to autonomous financial operations without first proving they can be
trusted with a number.
