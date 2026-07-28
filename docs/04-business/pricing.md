# Pricing & Monetization

> All figures are **planning estimates under stated assumptions**, not researched market data.
> The price points are hypotheses to test, not conclusions. §8 describes how to test them.

---

## 1. The pricing question, framed correctly

The wrong question is "what do competitors charge?" The right one is **"what is the alternative
worth, and what fraction of that can we capture?"**

For our buyer, the alternatives are:

| Alternative | Cost | What they get |
|---|---|---|
| Nothing | $0 | Anxiety, occasional disaster |
| Bookkeeper | $500–1,500/mo | Clean books, no advice |
| Fractional CFO | $3,000–8,000/mo _[verify]_ | Real advice, monthly, capacity-limited |
| Full-time CFO | $15,000–25,000/mo | Everything, unaffordable below ~$10M revenue |

We deliver a meaningful fraction of the fractional-CFO value, continuously rather than monthly. If a
fractional CFO is $4,000/mo, capturing 5% is $200/mo. That's the anchor, and it's the number the
sales conversation should be built around — not a comparison to a $30/mo SaaS tool.

**The value is also acutely concrete in a way most SaaS isn't.** One caught payroll shortfall, one
avoided overdraft, one $4,200/yr subscription cleanup pays for a year. That makes ROI arguments
unusually easy — provided we can point to specific saves, which is why the trial-end paywall recalls
actual findings ([onboarding §8](../01-product/onboarding.md#8-trial-and-conversion)).

---

## 2. Packaging

Three tiers plus a firm tier. Deliberately few — a six-tier matrix creates decision paralysis and
signals we don't know who we serve.

### Starter — $99/mo
*For businesses under ~$1M revenue, or those wanting cash visibility only.*

- 1 accounting + 3 bank connections
- Cash forecast (13 weeks), runway, payroll risk
- Weekly brief, critical alerts
- Ask: 30 questions/mo
- 1 user

### Growth — $249/mo *(the intended default)*
*For $1–10M revenue businesses. This is the tier we design for.*

- Unlimited connections including Stripe, payroll, commerce
- Everything in Starter, plus:
- Full metric suite, profitability analysis, customer profitability
- Scenario planning
- Business health score with benchmarking
- All alert types, all report types
- Ask: unlimited (fair use)
- 5 users, role-based access
- Accountant seat included (free)

### Scale — $599/mo
*For $10M+ revenue, multi-entity, or higher complexity.*

- Everything in Growth, plus:
- Multi-entity consolidation
- Custom metrics and custom alert rules
- API access
- SSO/SAML, advanced RBAC, audit export
- 20 users
- Quarterly review with a human analyst _(see §5 — this is deliberate)_

### Firm — $499/mo + $39/client/mo
*For accounting firms and fractional CFOs.*

- Multi-client console with attention ranking
- White-labeled reports
- Bulk report generation
- Unlimited firm users
- Volume pricing above 50 clients

**Design notes on the packaging:**

- **The accountant seat is free on Growth.** Every accountant with access is a channel conversation
  waiting to happen ([go-to-market §4](go-to-market.md)). Charging for that seat would be the most
  expensive $20/mo we ever collected.
- **Nothing is gated in a way that makes the product feel broken.** Starter has fewer features, not
  a crippled version of the same feature. A cash forecast that only shows 4 weeks would make us look
  bad rather than make them upgrade.
- **The question limit on Starter is the primary upgrade driver**, and it's the honest one: heavy
  users cost us more ([§7](#7-cogs-and-gross-margin)).

---

## 3. What we deliberately do not do

| Rejected model | Why |
|---|---|
| **Percentage of revenue** | Aligns incentives nicely, but SMBs hate it, it's hard to explain, and it makes our revenue swing with their seasonality. |
| **Per-transaction pricing** | Punishes exactly the businesses we most want (high volume = more data = better product). |
| **Freemium** | Our COGS per active business is real (Plaid + inference, §7). A free tier of connected businesses burns cash with no path to conversion. A 14-day trial gives the same top-of-funnel without the permanent liability. |
| **Free with monetization via lending/interchange** | Interesting long-term (§9), but building a subscription business first keeps incentives clean. Monetizing by steering customers toward credit while advising them on finances is a conflict our entire trust position can't survive. |
| **Per-seat as the primary axis** | Our value doesn't scale with seat count. Seats are a secondary expansion lever, not the meter. |

That fourth row matters more than it looks. A meaningful number of fintech products end up monetizing
their advice through lending referrals. For a product whose core claim is "we tell you the truth
about your money," that would be corrosive, and sophisticated buyers will ask about it.

---

## 4. Price sensitivity and the biggest open question

**The $249 Growth price is the highest-variance assumption in the entire plan.**

The case for it: it's 6% of a fractional CFO, trivially justified by one caught problem, and prices
us as a serious business tool rather than a utility.

The case against: SMB software buyers anchor hard on the $50–150 range, QuickBooks itself is ~$90/mo
_[verify]_, and being 2–3× the price of the system of record is a real psychological barrier.

**Recommendation: launch at $249 and discount tactically rather than launching at $149 and trying to
raise later.** Raising prices on an installed base is painful; discounting is easy. But treat this as
a hypothesis with a defined test (§8), not a decision.

**The strongest counter to price objections is not a discount — it's a specific save.** "In your
trial I found $4,200/yr in duplicate subscriptions" ends the conversation. Instrument for this.

---

## 5. The services question

The Scale tier includes a quarterly human review. This is deliberate and slightly heretical for a
software company.

**Why include it:**
- Larger customers want a human accountable for the numbers
- It's the highest-signal feedback loop we have — an analyst reviewing real accounts finds product
  gaps no eval catches ([ai-cfo-engine §7](../03-engineering/ai-cfo-engine.md#7-evaluation), Tier 4)
- It meaningfully raises retention at the top of the base

**Why to be careful:** services revenue has low margin and doesn't scale, and investors discount it.
Keep it capped, keep it a *feature of a software tier* rather than a separate line of business, and
watch that it stays under ~10% of revenue. If it grows past that, we're becoming a consultancy with
software, which is a different and worse company.

---

## 6. Expansion and net revenue retention

Target NRR: 100% at month 6, 115% at month 18.

| Lever | Mechanism |
|---|---|
| Tier upgrades | Starter → Growth as businesses grow or hit question limits |
| Seats | Team growth; finance hires |
| Entities | Multi-entity is a genuine Scale driver |
| Firm client count | The cleanest expansion in the model — firms add clients monthly |
| Future modules | Benchmarking, deeper tax planning, cash optimization (§9) |

**The firm tier is the best expansion engine** because it grows without new sales effort: a firm that
likes us adds clients on its own. Model it separately from direct SMB NRR, since blending them hides
what's working.

---

## 7. COGS and gross margin

Per-business monthly cost, at scale, from the infrastructure model in
[deployment §6](../03-engineering/deployment.md#6-cost-model):

| Component | Starter | Growth | Scale |
|---|---|---|---|
| Infrastructure | $1.20 | $2.00 | $4.50 |
| Plaid (per item) | $1.50 (3 items) | $3.00 (6 items) | $6.00 |
| LLM inference | $3.50 | $11.00 | $26.00 |
| Support (allocated) | $2.00 | $6.00 | $22.00 |
| **Total COGS** | **~$8.20** | **~$22.00** | **~$58.50** |
| Price | $99 | $249 | $599 |
| **Gross margin** | **92%** | **91%** | **90%** |

These are healthy — but the modeled inference figures assume the tier-routing discipline from
[ai-cfo-engine §9](../03-engineering/ai-cfo-engine.md#9-cost-management) holds. **Without routing,
inference cost roughly triples and Growth margin falls toward 75%.** That is the single largest
engineering lever on the business model, which is why the fast-tier ratio is tracked as an
engineering metric.

**The power-user risk.** A single Growth customer asking 40 complex questions a day costs far more
than $11/mo in inference. "Unlimited (fair use)" needs teeth: per-org token budgets, alerting on
outliers, and a defined conversation for genuine outliers. Model the tail, not just the mean — a
handful of unbounded accounts can erase the margin on a cohort.

---

## 8. How we actually test price

Not by guessing. A defined sequence:

1. **Months 1–6 (design partners):** price is nearly irrelevant; take $99–199 or free in exchange for
   deep feedback and a case study. The goal is learning, not revenue.
2. **Months 6–12:** launch published pricing at $99/$249/$599. Instrument objection reasons in every
   lost deal — "too expensive" vs. "not sure it works" are completely different problems with
   opposite responses.
3. **Van Westendorp survey** at ~100 customers to find the acceptable range empirically.
4. **Geographic or cohort A/B** on the Growth price ($199 vs. $249 vs. $299) at sufficient volume.
   Never A/B price to customers who can see each other's pricing — for SMB SaaS with a public pricing
   page, this means cohorting by signup date, not by segment.
5. **Annual review** with grandfathering. Grandfathering existing customers is worth more in goodwill
   than the marginal revenue.

**The metric that decides it is not conversion rate — it's payback period.** A lower price that
converts more but pushes CAC payback past 12 months is worse than a higher price with fewer, better
customers. Target: **CAC payback under 12 months, LTV:CAC above 3:1.**

---

## 9. Long-term monetization

Beyond subscription, in rough order of attractiveness:

| Opportunity | Attractiveness | Note |
|---|---|---|
| **Benchmarking data products** | High | We accumulate a genuinely valuable anonymized dataset. Sellable to lenders, insurers, and industry associations — with clear consent and disclosure. Near-zero marginal cost. |
| **Firm-tier expansion** | High | Already in the model; the cleanest growth path |
| **Cash optimization** (idle cash → yield, via partners) | Medium | Natural extension, real revenue share, moderate regulatory surface |
| **Financing marketplace** | Medium-Low | We know exactly when a business needs credit, which is valuable and *dangerous*. Any referral revenue must be disclosed prominently, or it poisons the trust that the whole product rests on. Approach with caution or not at all. |
| **Payments / money movement** | Low near-term | Large regulatory surface (money transmission licensing), large scope. Phase 4 at the earliest. |
| **Embedded/white-label** | Medium | Banks and platforms wanting an AI CFO for their SMB customers. Real, but a different company shape. |

The benchmarking product is the most underrated item here and the one most aligned with the
flywheel: it gets more valuable as we grow, costs almost nothing to produce, and *improves* the core
product rather than competing with it for attention.
