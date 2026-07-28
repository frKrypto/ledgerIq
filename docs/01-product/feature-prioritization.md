# Feature Prioritization

RICE-scored backlog, plus — more usefully — an explicit **cut list** with reasons.

**RICE** = (Reach × Impact × Confidence) ÷ Effort
· Reach: % of target users affected per quarter
· Impact: 3 massive / 2 high / 1 medium / 0.5 low
· Confidence: 100% / 80% / 50%
· Effort: engineer-weeks

RICE is a discussion tool, not an oracle. Where the score and judgment disagree, the reasoning column
wins — and says so.

---

## Tier 1 — Foundation (not scored; nothing works without these)

| Feature | Effort | Why unscored |
|---|---|---|
| Canonical schema + RLS + tenancy suite | 3 | A leak is company-ending |
| QuickBooks connector + normalization | 8 | Everything depends on it |
| Plaid connector | 3 | Cash truth |
| Dedup + transfer matching | 4 | Without it every number is wrong |
| Metric engine + golden fixtures | 5 | The product's correctness |
| Provenance / drill-down | 2 | The trust mechanism |

Scoring these would be theater. They're the price of entry.

---

## Tier 2 — Scored backlog

| # | Feature | R | I | C | E | RICE | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Cash forecast (13-week, banded) | 100% | 3 | 80% | 6 | **40** | The wedge |
| 2 | Payroll risk alert | 85% | 3 | 80% | 2 | **102** | Highest score, and correctly so |
| 3 | Weekly brief | 100% | 2 | 100% | 3 | **67** | The habit loop |
| 4 | Onboarding + progressive reveal | 100% | 3 | 80% | 5 | **48** | Gates everything downstream |
| 5 | AI answers — cash & profitability | 70% | 3 | 50% | 10 | **11** | Low score; ship anyway — see below |
| 6 | Drill-down UI | 90% | 2 | 100% | 3 | **60** | Trust mechanism |
| 7 | Dashboard (adaptive) | 95% | 1 | 100% | 5 | **19** | Verification surface, not discovery |
| 8 | Scenario planning | 55% | 3 | 80% | 6 | **22** | Highest-value *question*, narrower reach |
| 9 | Cash shortfall alert | 60% | 3 | 80% | 1 | **144** | Cheap, reuses forecast |
| 10 | Expense anomaly detection | 70% | 2 | 80% | 3 | **37** | |
| 11 | Subscription/vendor creep | 50% | 2 | 80% | 3 | **27** | The "leaks" answer; demos very well |
| 12 | Tax set-aside estimate | 65% | 2 | 50% | 4 | **16** | Confidence low — entity/state complexity |
| 13 | Stripe connector | 45% | 2 | 100% | 4 | **23** | Reconciliation is the real value |
| 14 | Customer profitability | 50% | 2 | 50% | 5 | **10** | Needs job-costing data most books lack |
| 15 | Health score | 80% | 1 | 80% | 4 | **16** | Communication device, not analysis |
| 16 | Monthly/board reports | 60% | 1 | 100% | 3 | **20** | |
| 17 | Firm console | 15% | 3 | 80% | 8 | **4.5** | **Score is misleading — see below** |
| 18 | CSV/PDF importer | 25% | 2 | 100% | 4 | **13** | Also the platform-risk hedge |
| 19 | Benchmarking | 60% | 2 | 50% | 6 | **10** | Blocked on cohort depth |
| 20 | Gusto connector | 35% | 2 | 100% | 3 | **23** | Sharpens the wedge |
| 21 | Xero connector | 20% | 2 | 100% | 5 | **8** | Gated on inbound demand |
| 22 | Public API | 10% | 1 | 80% | 5 | **1.6** | Ecosystem play, not near-term |
| 23 | Mobile app | 40% | 1 | 50% | 12 | **1.7** | Responsive web covers the job |

---

## Where the scores are wrong, and why we override them

RICE systematically misprices three things. Naming them prevents the framework from making decisions
it shouldn't.

**#17 Firm console (RICE 4.5) is a top-5 priority.** RICE measures reach *among current users*. The
firm console's entire value is that it *acquires* users — one firm brings 40–200 businesses at a
fraction of direct CAC ([go-to-market §4](../04-business/go-to-market.md#4-the-accountant-channel--the-core-strategy)).
RICE cannot see distribution leverage, so it will always underrate channel features. Build it in
phase 3 as planned, not when the score says.

**#5 AI answers (RICE 11) is the product.** The low score comes from high effort and low confidence
— both honest. But this is the differentiator; without it we're a dashboard tool with a good forecast.
RICE punishes exactly the ambitious, uncertain work that creates category positions.

**#7 Dashboard (RICE 19) is deliberately *deprioritized* below its score.** Reach is near 100%, which
inflates it. But the dashboard is where users *verify*, not where they discover
([PRD §5.5](prd.md#55-financial-dashboard)). Building it early would pull the whole product toward
being a dashboard company, which is the thing we're specifically not.

Meanwhile **#9 cash shortfall alert (RICE 144) genuinely is the best value in the list** — it reuses
the forecast engine almost entirely for one week of work. When RICE finds something like this, listen.

---

## The cut list

More decision-useful than the backlog. Each of these will be proposed repeatedly; here's the standing
answer.

| Cut | Argument for it | Why we're not doing it |
|---|---|---|
| **14 more integrations** | "Customers ask about them" | 4–8 eng-weeks each plus permanent maintenance. Three cover most value. CSV importer handles the tail. ([integrations §1](../03-engineering/integrations.md#1-the-case-against-breadth)) |
| **Our own general ledger** | "Own the data, be the system of record" | Multi-year build, head-on with Intuit, no wedge. Revisit only if third-party data quality becomes the binding constraint. |
| **Money movement / bill pay** | "Close the loop, obvious next step" | Money transmission licensing, custody risk, huge scope. Phase 4 at the earliest. |
| **Tax filing** | "We already estimate it" | Requires licensed preparers and per-state compliance. We estimate to plan cash; we hand off to file. |
| **Native mobile app** | "Everyone wants mobile" | 12 eng-weeks. Owners do financial work at a desk; the mobile job is *alerts*, covered by SMS/push + responsive web. |
| **Multi-currency** | "International customers ask" | Schema supports it; product doesn't need it for a US-first launch. Deferred, not designed out. |
| **Letting the AI take actions** | "It's the obvious endgame" | Advisory in V1. Acting inherits liability and regulatory surface before we've earned the trust to justify it. ([PRD §8](prd.md#8-open-questions)) |
| **A model fine-tuned on financial data** | "Better domain performance" | Our problem is grounding and orchestration, not domain knowledge. Locks us to a model version for little gain. |
| **RAG over transactions** | "Let the AI search the data" | Embeddings cannot aggregate. Will be proposed every six months; the answer is permanent. ([architecture ADR-007](../03-engineering/architecture.md#10-key-architectural-decisions-adr-summary)) |
| **Custom report builder** | "Enterprise asks for it" | Contradicts the entire thesis. Our value is *not* making users build their own analysis. |
| **White-label for banks** | "Big contracts" | Different company shape, different sales motion. Interesting later; fatal as a distraction now. |

The last row generalizes: at seed stage the most dangerous features are the ones with a *plausible
large revenue story attached*, because they're the hardest to say no to and the most likely to
consume a quarter.

---

## Decision framework

When something new is proposed, in order:

1. **Does it serve the wedge?** Cash-flow certainty for the primary persona. If not, it needs an
   unusually strong argument.
2. **Does it deepen trust or dilute it?** Anything that could produce a confidently wrong number is
   negative value regardless of RICE.
3. **Is it a distribution feature?** If so, RICE undercounts it — evaluate on channel leverage.
4. **What does it cost forever?** Connectors and integrations carry permanent maintenance; features
   carry permanent support surface.
5. **What does it displace?** With 4 engineers, everything is a trade. "What comes off the list?" is
   the question that ends most feature debates productively.

## Reprioritization triggers

Not on a calendar — on evidence:

- Week-4 retention below gate → stop everything, return to the wedge
- A connector requested by >30% of lost deals → reconsider the integration cut
- Firms failing to adopt after 15 conversations → the channel thesis needs rework
- Grounding violations above zero → all feature work stops until it's zero
