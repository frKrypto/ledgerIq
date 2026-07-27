# Marketing Strategy

Complements [go-to-market.md](go-to-market.md), which covers channels and sequencing. This document
covers positioning, message, and the content engine.

---

## 1. The message

**Primary:** *Your CFO, on call.*

**The expanded claim:**

> Ask any question about your business finances and get a real answer — computed from your actual
> numbers, with the reasoning shown. Not a dashboard. Not generic advice. The kind of answer you'd
> get from a CFO who knows your business.

**The proof point that does the most work:**

> "You'll be $14,200 short for the Nov 15 payroll. Here are three ways to fix it."

Lead with this everywhere. It's specific, checkable, and hits the fear that actually drives purchase.
Abstract claims about "financial intelligence" convert nothing.

---

## 2. Messaging hierarchy by audience

| Audience | Lead with | Because |
|---|---|---|
| Owner in cash stress | "Know about payroll problems three weeks early" | Acute pain, immediate purchase intent |
| Owner making a decision | "Find out if you can afford to hire — before you commit" | Decision-triggered, high consideration |
| Owner generally frustrated | "Stop guessing from your bank balance" | The universal status quo |
| Accountant / fractional CFO | "Serve more clients without more hours" | Capacity is their binding constraint |
| Investor | "The semantic layer for SMB finance, with a forecast-accuracy flywheel" | Different conversation entirely — see [fundraising](fundraising.md) |

**Never lead with "AI."** It's a mechanism, not a benefit, and in financial services it currently
*subtracts* trust as often as it adds it. The word appears in our copy where it's honest and useful,
never as the headline.

---

## 3. The website

Structured as an argument, not a brochure.

**Above the fold:** not a dashboard screenshot. A real question and a real answer, in the product's
answer format — headline, figures, assumptions, confidence. The value is legible in five seconds
because you can read the answer and understand it.

Then, in order:
1. **The question input** — same as onboarding. Ask anything; see it answered on sample data. This
   is the single highest-converting element on the site.
2. **Three questions answered** — payroll, hiring, leaks. Real screenshots.
3. **How it works** — three steps, emphasizing read-only and the drill-down-to-source guarantee
4. **The trust section** — security, "we never move money," SOC 2 status stated honestly, drill-down
   demo
5. **Who it's for** — segment-specific with real numbers
6. **Accountants** — dedicated path, prominent
7. **Pricing** — public, simple, no "contact us" for the main tiers
8. **Proof** — customer stories with specifics

**Pricing is public.** Hiding it signals enterprise sales and wastes our buyer's time. They will
leave rather than fill in a form.

---

## 4. The content engine

Our buyer searches for their *question*, not our category. Every question the product answers is a
content asset, and the landing-page question capture gives us a continuously updated list of what
real prospects actually ask.

### The core format

For each high-intent question:
1. A genuinely useful, complete answer — the kind a good CFO would give, not SEO filler
2. An interactive calculator with sensible defaults
3. Worked examples with real numbers
4. A soft close: *"Or connect your books and get this answered with your actual numbers."*

**The calculator is the conversion mechanism.** It demonstrates competence before signup and it earns
links, which is what makes the SEO compound.

### Launch content set

Cash & survival — how much reserve to keep · calculating runway · surviving a slow quarter · what to
do when a big client pays late

Hiring — can I afford another employee · the true cost of an employee · contractor vs. employee ·
when to hire vs. outsource

Profitability — why profitable businesses run out of cash · finding your most profitable customers ·
pricing for margin · reading your own P&L

Planning — building a 13-week cash forecast · scenario planning for small business · setting aside
for taxes · preparing for a loan application

**"Why profitable businesses run out of cash"** is the single best piece to lead with. It's the
counterintuitive truth at the heart of the product, it's genuinely useful, and it names a problem the
reader has lived through without understanding.

### Distribution

The content is the asset; distribution multiplies it. Newsletter, LinkedIn (both founder and company
— accountants live there), YouTube for the calculator walkthroughs, and syndication into the
communities where the audience already is.

---

## 5. Proof and trust

For a product asking to see everything, proof matters more than message.

**Customer stories with real numbers.** "Caught a $14,000 payroll gap three weeks out" beats "great
product, highly recommend." Specific, verifiable, and it demonstrates the mechanism.

**Publishing our own forecast accuracy is the strongest trust asset available to us** — and almost
nobody in this category does it. "Our 30-day cash forecasts have been within 6% across 1,200
businesses" is a claim competitors can't casually match, because making it requires having measured
it from day one ([ai-cfo-engine §7](../03-engineering/ai-cfo-engine.md#7-evaluation)).

It's also a commitment device: publishing a number makes it very hard to quietly stop improving it.

**The drill-down demo.** A 20-second video: ask a question, get a number, click the number, see the
transactions. This does more competitive work than any comparison page
([competitive §8](competitive-analysis.md#8-competitive-messaging)).

**Security page** written for a real buyer, not a compliance checkbox: what we can and can't do,
where data lives, honest SOC 2 status with dates. And — per
[security §4](../03-engineering/security.md#4-encryption) — we do **not** claim end-to-end
encryption, because it isn't true for a product that computes over the data. Precision here is
itself a trust signal.

---

## 6. Brand marketing

Restrained, consistent with [brand-identity.md](../02-design/brand-identity.md): competent and calm, not clever.

**The founder voice is the primary brand channel early.** Building in public, sharing genuine
insights from aggregate data ("here's what 500 small businesses' cash cycles actually look like"),
being useful in public. This is high-leverage and costs nothing but time.

**The aggregate-data angle is a durable, underrated asset.** As we grow, we can publish genuinely
novel research about SMB finance — payment behavior by industry, seasonality patterns, what
distinguishes businesses that survive a downturn. Nobody else has this data in this form. It earns
press, links, and credibility, and it feeds directly back into the benchmarking product
([pricing §9](pricing.md#9-long-term-monetization)).

Requires clear consent and rigorous anonymization, and should be reviewed against the privacy policy
before the first publication rather than after.

---

## 7. Budget shape

Early stage, monthly, illustrative:

| Line | Phase 1 (mo 6–12) | Phase 3 (mo 15+) |
|---|---|---|
| Content production | $4,000 | $12,000 |
| Design/web | $1,500 | $4,000 |
| Community & events | $1,000 | $4,000 |
| Tools | $500 | $1,500 |
| Paid | $0 | $15,000+ |
| **Total** | **~$7,000** | **~$36,500** |

**Zero paid spend before phase 3 is deliberate**, not a budget constraint
([go-to-market §2](go-to-market.md#2-sequenced-motions)). Paid acquisition on an unretained product
converts capital into churn.

---

## 8. Metrics

| Metric | Target (mo 12) | Why |
|---|---|---|
| Organic sessions/mo | 15,000 | Content engine working |
| Question-input engagement | >10% of visitors | Highest-signal on-site action |
| Visitor → signup | >3% | Site is doing its job |
| Content → trial | >2% | Content attracts the right people, not just traffic |
| Branded search volume | Growing MoM | Brand is forming |
| Firm-sourced signups | >30% of new | The core channel is working |

**Traffic is a vanity metric here.** The one that matters is question-input engagement — it means
someone with a real financial question arrived and engaged. Optimize for that, not for sessions.
