# Competitive Analysis

> **Sourcing note.** Pricing, positioning, and capability claims below are from general market
> knowledge as of the plan's writing and are **not verified against current published pricing**.
> Competitor pricing changes frequently. Everything marked _[verify]_ needs primary sourcing before
> it appears in a pitch, a battlecard, or a comparison page — a wrong competitor price on a public
> page is both an own-goal and, in some jurisdictions, actionable.

---

## 1. Framing the competitive set correctly

The instinct is to list "AI CFO" startups. That's the wrong frame — it optimizes for beating startups
nobody has heard of.

The real competitive set is **everything a business owner currently does instead of buying us**:

| Layer | What it is | Why they use it | How we win |
|---|---|---|---|
| **The status quo** | Checking the bank balance; gut feel | Free, familiar, zero effort | Show them what the balance hides. This is the majority of the market. |
| **The human** | Bookkeeper, fractional CFO, accountant | Trusted, accountable, contextual | Complement, don't replace. Sell *to* them (§6). |
| **The incumbent tools** | QuickBooks, Xero + their reporting | Already paid for | We answer questions they only report on. |
| **The dashboard layer** | Fathom, Reach Reporting, Jirav, Float, LivePlan | Better visualization | We remove the interpretation burden they leave in place. |
| **The AI-native entrants** | Various seed-stage "AI CFO" products | Same thesis as ours | Execution on grounding and forecast accuracy. |
| **The platform threat** | Intuit, Ramp, Brex, Mercury shipping AI natively | Distribution, existing data | §5 — the honest answer. |

**Our real competitor is inertia.** The most common outcome of a sales conversation is not "we chose
someone else," it's "we did nothing." Positioning, pricing, and onboarding should all be designed
against *doing nothing* first and against named competitors second.

---

## 2. The dashboard layer

Products like Fathom, Jirav, Float, and Reach Reporting sit on top of QuickBooks/Xero and produce
better reporting, KPI tracking, and cash forecasting than the accounting software does. _[verify:
current pricing; historically roughly $50–$400/mo depending on tier and client count]_

**Their strength:** mature, established in the accountant channel, genuinely good at visualization
and at the report-production workflow firms need.

**Their structural weakness:** they are *reporting* tools. They render a metric beautifully and leave
the interpretation to the user — which is exactly the burden our buyer cannot carry. Their primary
buyer has drifted toward accounting firms rather than owners, precisely because owners can't
self-serve on a dashboard.

**How we win:** we answer rather than display. The demo contrast is stark and easy to run — put
"why did profit drop?" into both products and watch one produce a chart and the other produce a
causal explanation with a recommended action.

**How we could lose:** they add an LLM layer over their existing data model and distribution. This is
the most likely competitive move in the category. Our defense is that bolting chat onto a reporting
schema produces exactly the ungrounded-answer problem we architected against
([ai-cfo-engine §2](../03-engineering/ai-cfo-engine.md#2-the-central-constraint-the-model-never-computes)) —
they will ship it faster than us and it will be less trustworthy. That's a real window, but it's a
window, not a moat. It closes in 18–24 months.

---

## 3. The AI-native entrants

Several seed-stage companies share our thesis. Assume more launch during our build.

**What most of them get wrong, and where we differentiate:**

1. **They let the model touch the numbers.** Dumping transactions into a context window and asking
   for analysis. Demos beautifully, fails on the first wrong figure. Our entire architecture exists
   to make this impossible.
2. **They lead with chat and ship a chat box.** Chat has poor standalone retention
   ([PRD §2.1](../01-product/prd.md#21-the-wedge)). We lead with the payroll alert.
3. **They chase integration breadth** as a differentiator, which consumes the first year
   ([integrations §1](../03-engineering/integrations.md#1-the-case-against-breadth)).
4. **They don't measure forecast accuracy**, so they can't improve it and can't claim it.

**The honest risk:** at least one of them is making the same choices we are. Our edge then reduces to
execution speed and the accountant channel. That's a normal competitive position, not a crisis — but
it means we should not pitch "nobody else is doing this," which is both false and a credibility
tell to any investor who has seen the category.

---

## 4. Incumbents in accounting

**Intuit (QuickBooks)** is the elephant. Dominant SMB accounting share, owns the data we depend on,
and is shipping AI aggressively.

**Xero** — strong outside the US, better product design, similar AI trajectory, less aggressive.

Both have distribution we cannot match. Their weaknesses are structural rather than a matter of
competence, which is what makes them exploitable:

- **Single-source view.** Intuit's answers come from the QuickBooks GL. The interesting answers
  require reconciling the GL against the bank against Stripe. Intuit is structurally reluctant to
  treat its own ledger as one input among several.
- **Data quality dependence.** Intuit's AI inherits whatever mess is in the books. We can detect and
  route around bad data because we have corroborating sources.
- **Innovator's dilemma on advisory.** Their accountant channel is a large revenue stream. A product
  that reduces the need for advisory hours is awkward internally. We have no such conflict.
- **General-purpose vs. specific.** They serve every business type. We can be opinionated about a
  segment.

---

## 5. The two competitors that could actually kill us

Being honest about this is more useful than a favorable grid.

### 5.1 Intuit doing this properly

If Intuit ships a genuinely good AI CFO inside QuickBooks — grounded, accurate, well-designed — they
win most of the market by distribution alone. Millions of businesses, zero acquisition cost, no
integration step, no trust barrier.

**Probability: moderate-to-high within 3 years.** They have the data, the money, and the intent.

**Why we might still have a business:**
- Big-company AI ships slowly, conservatively, and generically. The specific, opinionated,
  action-oriented product we're describing is hard to build inside a large organization.
- Their answers are limited to their data. Multi-source reconciliation is our whole insight.
- A meaningful segment actively wants a layer *independent* of their accounting vendor — the same
  reason people use independent financial advisors.
- Their advisory-channel conflict is real and slows them.

**What we do about it:** move fast on the multi-source semantic layer, build the forecast-accuracy
flywheel that requires years of outcome data, and own the accountant relationship so we're
*complementary* to the channel Intuit is conflicted about disrupting. If they ship something great
and we haven't reached escape velocity, an acquisition is a legitimate outcome — and we should build
so that it's an attractive one rather than pretending it isn't a scenario.

### 5.2 The spend-management platforms moving up

**Ramp, Brex, and Mercury** already hold real-time transaction data, already have the customer
relationship, monetize through interchange and float rather than subscription, and are all moving
toward financial intelligence.

**This is the more underrated threat.** Ramp in particular has shown it will ship aggressively beyond
its original category, and its economics let it give away software that we need to charge for.

**Why we might still have a business:**
- They see card spend, not the complete financial picture — no AR, no accrual revenue, no payroll
  detail, no GL.
- Their business model pulls them toward spend optimization, not toward "should I hire?"
- They are not going to integrate deeply with QuickBooks as a *dependency*; that's not their
  strategic direction.

**What we do about it:** stay adjacent rather than competitive. Integrate them as a data source.
Consider them a partnership and, eventually, an acquisition channel.

---

## 6. Fractional CFOs and accounting firms — channel, not competitor

Framing them as competition is the strategic error to avoid.

A fractional CFO charges $3–8K/mo _[verify]_ and is capacity-constrained by their own hours. We make
them more profitable: more clients per hour, better prep, faster reporting. The right posture is a
tool that makes them look good to their clients, not a replacement that threatens them.

Our firm tier is deliberately designed for this — multi-client console, white-labeled reports,
work-paper-grade drill-down ([user-flows §9](../01-product/user-flows.md#flow-9--accountant-multi-client-console)).

**This is the single highest-leverage go-to-market decision in the plan.** One firm brings 40–200
businesses with pre-cleaned books and a trusted introduction, at a fraction of direct-SMB CAC. See
[go-to-market §4](go-to-market.md).

---

## 7. Positioning map

Two axes that actually separate the field:

```
              ANSWERS THE QUESTION
                       ▲
                       │
        LedgerIQ ●     │
                       │        ● Fractional CFO
                       │          (expensive, doesn't scale)
   ────────────────────┼────────────────────────▶
   AUTOMATED           │                    HUMAN
                       │
   ● Fathom/Jirav      │      ● Bookkeeper
   ● QuickBooks        │
   ● Ramp/Brex         │
                       │
              SHOWS THE DATA
```

**The upper-left quadrant is empty and is the whole opportunity:** the quality of a CFO's judgment at
software cost and availability. Everything automated today sits in the lower half; everything in the
upper half is a person.

---

## 8. Competitive messaging

| Against | Say | Never say |
|---|---|---|
| Doing nothing | "Your bank balance doesn't tell you about the Nov 15 payroll. We do, three weeks early." | Anything implying they've been irresponsible |
| QuickBooks | "QuickBooks records what happened. We tell you what to do about it." | That QuickBooks is bad — they chose it and we depend on it |
| Dashboard tools | "They show you a chart of your margin. We tell you which account caused it and what to do." | Feature-by-feature comparison — we'd lose on report count |
| Other AI tools | "Ask both the same question, then click into the numbers. Ours trace to source transactions." | "We're the only ones doing this" — false and it reads as naive |
| A fractional CFO | "Keep them. We'll make their hours go further and cover the other 29 days." | That we replace them |
| Intuit's AI | "Ours reconciles your bank, Stripe, and books against each other. Theirs sees one of the three." | Anything defensive |

**The strongest demo in the sales motion is drill-down.** Ask any competitor's AI a numeric question
and try to click the number. Ours resolves to source transactions; most don't have the concept. That
single interaction does more competitive work than a comparison grid.

---

## 9. What would change this analysis

Tripwires to watch, each with a pre-agreed response so we're not deciding under pressure:

| Signal | Response |
|---|---|
| Intuit ships a grounded, accurate AI CFO in QBO | Accelerate the firm channel and multi-source positioning; open strategic conversations |
| A dashboard incumbent ships a credible grounded AI layer | Compete on forecast accuracy — publish ours, invite comparison |
| Ramp/Brex ship SMB financial planning free | Move upmarket and lean harder on accrual/AR depth they lack |
| A well-funded AI-native competitor raises a large round | Don't match spend; win on accuracy and the accountant channel |
| Plaid or Intuit restrict API access to competitors | Existential — maintain direct relationships and a CSV fallback from day one ([integrations §5](../03-engineering/integrations.md#5-the-universal-fallback-csv-and-pdf-import)) |

That last row deserves attention disproportionate to its probability. Our entire product depends on
API access from a company that may compete with us. The CSV importer is not just a long-tail feature
— it's a hedge on platform risk, which is a reason to build it in V1 rather than defer it.
