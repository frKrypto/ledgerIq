# Go-to-Market Strategy

> Conversion rates, CAC figures, and channel costs are **modeled assumptions**, not measured data.
> They are stated explicitly so they can be replaced with real numbers as soon as we have them.

---

## 1. The core GTM problem

SMB SaaS go-to-market is brutal and the reasons are structural:

- The market is enormous but atomized — no efficient way to reach them at scale
- Paid acquisition costs are high relative to a $249/mo ACV
- Sales cycles are short but volume must be large, and the deal size doesn't support a rep
- Churn is high because small businesses themselves fail
- Trust barriers are severe for financial data specifically

Most SMB fintech startups die of CAC, not of product. **So the GTM plan must lead with the channels
that have structurally low CAC, and treat paid acquisition as a later accelerant rather than the
engine.**

That is why the accountant channel (§4) is not a "secondary segment" in this plan — it's the core
strategy.

---

## 2. Sequenced motions

Four phases, each gated on evidence rather than a calendar.

| Phase | Months | Motion | Goal | Gate to advance |
|---|---|---|---|---|
| 0 — Design partners | 0–6 | Founder-led, hand-picked | 15–25 businesses, deep feedback | 10+ actively using weekly; 3 case studies |
| 1 — Founder-led sales | 6–12 | Direct outreach, communities, content | 100–150 paying | Week-4 retention >45%; repeatable pitch |
| 2 — Accountant channel | 9–18 | Firm partnerships | 15–25 firms → 600–1,200 businesses | Firm NPS positive; 2+ firms self-expanding |
| 3 — Scaled acquisition | 15+ | Content, SEO, paid, partnerships | Volume | CAC payback <12mo proven |

**The most common failure mode is skipping to phase 3.** Paid acquisition before retention is proven
converts investment into churn. The gate on week-4 retention before scaling is the most important
discipline in this document.

---

## 3. Phase 0 — design partners

**Target: 15–25 businesses**, hand-picked, heavily biased toward:

- 10–50 employees, $1–10M revenue, services businesses (agency, contractor, clinic, studio)
- QuickBooks Online users with reasonably clean books
- Owners who are actively worried about cash — the buying trigger
  ([PRD §3.1](../01-product/prd.md#31-primary-persona--dana-the-owner-operator))

**Where to find them:** founder networks, local business associations, industry Slack and Discord
communities, accountant referrals, r/smallbusiness and similar (participate genuinely; do not spam).

**The offer:** free for 6 months in exchange for real engagement — a weekly call for the first month,
honest feedback, and a case study if it works.

**What we're actually learning** (this is not a revenue exercise):
1. Which questions do they actually ask? (Instrumented from the landing-page question capture.)
2. Where do our answers fail or feel untrustworthy?
3. What makes them come back in week 4, not week 1?
4. What would they actually pay?
5. How bad are real books, really?

**The disqualifying signal:** if design partners stop opening the weekly brief by week 6, the wedge
is wrong and no amount of GTM fixes it. That's worth knowing at month 5 rather than month 18.

---

## 4. The accountant channel — the core strategy

**This is the highest-leverage decision in the plan.**

### Why it works

| Direct SMB | Via a firm |
|---|---|
| CAC ~$400–900 (modeled) | CAC ~$40–120 per business (modeled) |
| Cold trust | Warm introduction from a trusted advisor |
| Books quality unknown | Books already clean — the firm maintains them |
| One business at a time | 40–200 businesses per relationship |
| Churn when the business churns | Firm relationship persists across client churn |

One firm partnership can be worth a quarter of direct sales effort. And crucially, the firm has
*already solved the trust problem* — the client's accountant recommending us is worth more than any
security page.

### Why firms want it

The economics are compelling from their side, which is what makes this durable rather than a favor:

- **They bill for advisory hours they currently spend on data assembly.** Roughly 60% of client time
  goes to gathering and formatting, 40% to advice. Inverting that ratio is the pitch.
- **They can serve smaller clients profitably**, expanding their own addressable market.
- **They look modern** to clients who are asking about AI.
- **Bulk report generation** alone saves a partner hours every month
  ([user-flows §9](../01-product/user-flows.md#flow-9--accountant-multi-client-console)).

### The approach

1. **Start with fractional CFOs, not large firms.** They're faster to close, more entrepreneurial,
   more willing to try new tools, and they feel the capacity constraint most acutely. Large firms
   have procurement, security review, and partner consensus.
2. **Land with one partner, not the firm.** Get one person's practice working, let them evangelize
   internally.
3. **Free pilot on 5 clients**, then convert to the firm tier.
4. **Never disintermediate.** The firm owns the client relationship, always. Our reports are
   white-labeled. If we ever appear to be going around them, the channel closes permanently and word
   spreads fast in a small professional community.
5. **Build for their liability.** An accountant is professionally accountable for numbers they
   present. Work-paper-grade drill-down isn't a nice-to-have; it's the thing that makes them willing
   to put their name on our output.

### Where to reach them

Accounting-profession communities and conferences, QuickBooks ProAdvisor networks, fractional-CFO
communities, LinkedIn (accountants are unusually active there), and the accounting-influencer
ecosystem, which is small, real, and reachable.

**Target: 15–25 firm partnerships by month 18**, averaging 40 clients each.

---

## 5. Direct acquisition

### Content and SEO — the primary long-term engine

Our buyer searches for the *question*, not for the category. Nobody googles "AI CFO platform." They
google **"how much cash should a small business keep in reserve"** and **"can I afford to hire
another employee."**

That's a large, high-intent, underserved keyword surface, and it maps exactly onto our product. Every
question our product answers is a content asset.

The format that compounds: genuinely useful answers to the specific question, with an interactive
calculator, ending in "or connect your books and get this answered with your actual numbers." The
calculator is the conversion mechanism — it demonstrates the value before signup.

**We have an unfair advantage in this channel:** the landing-page question capture
([onboarding §3](../01-product/onboarding.md#step-0--ask-the-question-first-000)) gives us a
continuously growing dataset of what real prospects actually want to know, in their own words. That
is a content roadmap most companies pay agencies to guess at.

### Communities

Genuine participation in r/smallbusiness, industry-specific forums, and owner Slack/Discord
communities. Answer questions with real analysis, don't pitch. Slow, unscalable, and the highest-trust
channel available early.

### Partnerships

Integration marketplaces (QuickBooks App Store is the highest-value listing — our users are already
there), plus banks and business-service providers wanting to offer financial intelligence.

### Paid — deliberately last

Paid search on high-intent question keywords, retargeting, and LinkedIn for the accountant audience.

**Not before phase 3, and not before CAC payback is proven under 12 months.** Paid acquisition is an
amplifier; amplifying an unretained product just burns money faster.

---

## 6. Funnel targets

Modeled, to be replaced with measurement:

| Stage | Rate | Note |
|---|---|---|
| Visitor → question asked | 8–12% | Landing page's primary CTA |
| Question → signup | 35–45% | They've already engaged |
| Signup → connected | 55% | **The critical step** ([onboarding §4](../01-product/onboarding.md#4-activation)) |
| Connected → activated | 90% | Insight delivered |
| Trial → paid | 25–35% | No credit card up front lowers this rate but raises volume |
| **Visitor → paid** | **~1.0–1.8%** | |

**CAC targets by channel** (modeled):

| Channel | CAC | Payback at $249 |
|---|---|---|
| Accountant channel | $40–120 | <1 month |
| Content/SEO (at maturity) | $150–300 | 1–2 months |
| Community/referral | $50–150 | <1 month |
| Paid search | $600–1,100 | 4–7 months |
| **Blended target** | **<$400** | **<3 months** |

---

## 7. Retention — where SMB SaaS actually dies

Acquisition gets the attention; retention determines whether the company works.

**The structural problem:** ~20% of our customers' businesses will fail or shrink each year, and
that's churn we cannot prevent. So controllable churn must be very low to compensate.

**The retention mechanics we're building, in order of importance:**

1. **The weekly brief** — the habit loop. Open rate is a top-line metric because it predicts churn
   better than login count.
2. **Proactive alerts** — every accurate alert is a reason we earned our fee that month.
3. **The forecast-accuracy flywheel** — the product gets measurably better with tenure, so the cost
   of leaving rises.
4. **Multi-user and accountant access** — accounts with 2+ users retain markedly better.
5. **Accumulated context** — scenarios, annotations, dismissed findings, tuned thresholds. Leaving
   means losing history.

**The leading indicator to watch:** weekly brief open rate. It degrades weeks before churn shows up
in billing, which makes it the intervention trigger.

---

## 8. Sales motion

**Starter/Growth: fully self-serve.** No demo required, no sales call. At $99–249/mo the economics
don't support a rep, and our buyer prefers to try it themselves.

**Scale: light-touch.** Founder- or AE-led, single call, security review support.

**Firm: relationship sales.** Real conversation, pilot, onboarding support. Worth the effort at
40–200 businesses per deal.

**The demo that closes deals is not a feature tour.** It's connecting *their* QuickBooks live and
asking *their* question. That is either extremely compelling or it exposes that we're not ready —
both are useful outcomes, and we should be willing to run it.

---

## 9. Metrics that govern the plan

| Metric | Gate | Meaning if missed |
|---|---|---|
| Week-4 retention | >45% before scaling spend | The wedge is wrong; fix product, not marketing |
| Weekly brief open rate | >45% | The habit loop isn't forming |
| Activation | >55% | Onboarding is broken |
| CAC payback | <12 months | Cannot scale paid |
| LTV:CAC | >3:1 | Unit economics don't work |
| Firm client attach | >30 per firm | Firm tier isn't delivering leverage |
| NRR | >100% by month 6 | Expansion isn't offsetting churn |

**The two that gate everything else are week-4 retention and CAC payback.** Everything in phase 3
is contingent on both, and no amount of pipeline pressure should be allowed to override them.
