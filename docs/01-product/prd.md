# LedgerIQ — Product Requirements Document

**Version:** 1.0 (founding) · **Status:** Draft for team alignment · **Owner:** Product

---

## 1. Problem

### 1.1 The observable pain

An owner of a $3M-revenue agency with 22 employees has QuickBooks, a Chase business account, Stripe,
and Gusto. Four systems, four logins, four versions of the truth. When they ask a question that
matters — *"can I afford two more people?"* — none of those systems answer it. QuickBooks shows what
already happened, in a vocabulary they were never taught. The bank shows a balance with no context.
Stripe shows revenue that doesn't tie to the P&L.

So they do one of three things:

1. **Guess**, using bank balance as a proxy for health. This is the default, and it's why healthy,
   profitable businesses run out of cash.
2. **Ask their bookkeeper**, who can produce a report but is not qualified to advise, and who is
   working on a 30-day lag.
3. **Hire a fractional CFO** at $3–8K/mo, which is only rational above roughly $2M revenue and even
   then delivers advice in a monthly batch.

### 1.2 Why this is a real market and not a feature

The gap is structural, not a UI problem. Answering *"can I afford to hire?"* requires:

- Normalizing data across four systems with incompatible models (accrual GL vs. cash bank feed vs.
  Stripe's gross-vs-net vs. payroll's burdened cost)
- Building a forward projection with seasonality, receivables timing, and committed spend
- Applying judgment: what's a safe cash buffer, what's the real fully-loaded cost of an employee,
  what's the ramp before they're productive
- Communicating it in a way a non-financial person can act on

Existing tools do step one badly and stop. The synthesis and judgment are exactly what LLMs became
good at, *provided the arithmetic is not left to them.* That's the opening, and it's new — this
product was not buildable in 2019.

### 1.3 Why now

- Accounting APIs (QuickBooks Online, Xero) and bank aggregation (Plaid) are mature and stable.
- Frontier models can reliably plan multi-step analysis and explain financial reasoning in plain
  language — a capability that did not exist at usable quality or price before ~2023.
- Inference cost per complex analytical answer has fallen enough that a $199/mo subscription carries
  healthy gross margin (modeled in [pricing](../04-business/pricing.md#7-cogs-and-gross-margin)).
- SMB owners now *expect* to type a question and get an answer. The interaction model needs no
  education, which removes the single biggest adoption barrier this category historically had.

---

## 2. Strategy: what we build first, and why

### 2.1 The wedge

**Ship cash-flow certainty before shipping intelligence.**

The temptation is to lead with the chat box, because it demos beautifully. Resist it. Chat is
unfalsifiable — a user cannot tell whether a well-written answer is right, so it generates delight in
week 1 and indifference by week 4. What creates dependency is a *specific, checkable, high-stakes
claim*:

> **"You will be $14,200 short for the Nov 15 payroll. Here are three ways to fix it."**

That is falsifiable, it recurs on a schedule the user cannot ignore, and it maps to the single most
acute fear in small business. When we're right, trust compounds. When we're early enough to matter,
the product has saved them from a catastrophe, and they will not churn.

So the V1 ordering is:

1. **Cash flow forecast + payroll risk alert** (the wedge — creates dependency)
2. **Weekly brief** (the habit — creates recurring reason to open)
3. **AI CFO chat** (the depth — creates the "wow" and handles the long tail)
4. **Dashboard** (the reassurance — where users go to verify, not to discover)

Note that the dashboard is *fourth*. This is deliberate and will feel wrong to everyone. Dashboards
are where financial products go to die: they put the burden of interpretation back on a user who
came to us precisely because they can't interpret. The dashboard exists to make the AI's claims
verifiable, not to be the primary surface.

### 2.2 What we are explicitly not building (V1)

| Not building | Why |
|---|---|
| Our own general ledger / bookkeeping | Multi-year build, competes with QuickBooks head-on, no wedge. We are the brain, not the books. |
| Invoicing, bill pay, money movement | Regulatory surface (money transmission licensing) and huge scope. Revisit in Phase 3 as the monetization expansion. |
| Tax filing | Requires licensed preparers and per-state compliance. We *estimate* liability and hand off. |
| A mobile app | Owners check finances at a desk. A responsive web app plus SMS/push alerts covers the mobile job. Native app is a Phase 3 retention play. |
| 14 of the 17 requested integrations | See [integration strategy](../03-engineering/integrations.md). Each connector is ~3–6 engineer-weeks including normalization and ongoing breakage. Three cover most of the value. |
| Multi-currency and multi-entity | Real demand, but from a segment (larger, international) we're not targeting yet. Schema is designed to accommodate both so we don't have to migrate later. |

### 2.3 The strategic risk we're accepting

We sit on top of QuickBooks. That means Intuit could build this. The honest answer to that objection
is in [competitive analysis §5](../04-business/competitive-analysis.md#5-the-two-competitors-that-could-actually-kill-us);
in short, our defensibility is not the integration, it's the forecast-accuracy flywheel plus the
multi-source semantic layer that Intuit is structurally reluctant to build because it requires
treating their own GL as one input among several.

---

## 3. Users

### 3.1 Primary persona — "Dana, the owner-operator"

- Runs a 10–50 person services business (agency, contractor, clinic, studio); $1–10M revenue
- Financially literate in the way a smart person is: understands profit, does not understand accrual
  vs. cash, deferred revenue, or why the P&L says profit while the bank says otherwise
- Checks the bank balance most mornings. This is their entire financial dashboard today.
- Decisions they lose sleep over: hiring, pricing, whether to take a loan, whether a big client
  leaving would be survivable
- **Buying trigger:** a cash scare. Nearly every conversion follows a near-miss on payroll, a
  surprise tax bill, or a client who paid 60 days late.

**Jobs to be done**
- *When payroll is coming up, I want to know I'll make it, so I can stop checking the balance daily.*
- *When I'm considering a hire, I want to know if it's safe, so I can commit without dread.*
- *When profit drops, I want to know why in one sentence, so I can fix the cause not the symptom.*

### 3.2 Secondary persona — "Marcus, the fractional CFO / accounting firm partner"

- Serves 8–60 SMB clients; the bottleneck is his own hours
- Spends 60% of client time on data assembly and 40% on advice; wants to invert that
- **This persona is our distribution channel, not just a segment.** One firm signing up brings
  40–200 businesses with pre-cleaned books and a trusted introduction.
- Needs: multi-client console, cross-client risk ranking, white-label reports, work-paper-quality
  drill-down (he will be blamed if a number is wrong)

**Jobs to be done**
- *When I start my week, I want to know which of my 40 clients need attention, so I spend hours where they matter.*
- *When I present to a client, I want a report I can defend line-by-line, so my reputation is safe.*

### 3.3 Anti-personas (we will say no to these)

- **Pre-revenue solo founders** — no data to reason over, no willingness to pay. Free tier at best.
- **Enterprise finance teams** — have a real CFO and a real FP&A stack; wrong product, wrong sale.
- **Businesses without accounting software** — if the books don't exist, we have nothing to compute
  on. We should decline the signup rather than deliver a bad experience. (See
  [onboarding §6](onboarding.md#6-the-disqualification-path).)

---

## 4. Product principles

1. **Never show a number we can't trace.** Every figure in the product drills down to source
   transactions. This is non-negotiable and shapes the architecture.
2. **Answer, then explain, then show.** The first sentence is the answer. Reasoning is second.
   Charts are third, and collapsed by default.
3. **State confidence and assumptions, always.** "You'll be short $14K" is dishonest without "assumes
   your two overdue invoices land within 15 days, as they have historically."
4. **Recommend an action, not an observation.** "Margins fell 4 points" is a report. "Margins fell 4
   points because subcontractor cost outpaced billing on the Vertex account — reprice or cap it" is
   a CFO.
5. **Prefer being useful to being complete.** A confident answer to the six questions that matter
   beats a hedge across sixty.
6. **Silence is a feature.** An alert that fires when nothing is wrong trains users to ignore alerts.
   We hold a strict false-positive budget (see §5.4).

---

## 5. Feature specifications

### 5.1 AI CFO Chat

**What it is.** A conversational surface where the user asks any financial question and receives a
grounded, cited answer.

**How it works** (detail in [AI CFO Engine](../03-engineering/ai-cfo-engine.md)): the question is
classified and routed to a *plan*; the plan calls deterministic metric functions and a query layer;
results are computed in code; the model narrates only over computed values. The model has no ability
to emit an unsourced number — numbers are injected into the response as typed tokens that the
renderer resolves.

**Answer contract.** Every answer renders in this structure:

| Slot | Content | Required |
|---|---|---|
| Headline | Direct answer in one sentence, plain language | Yes |
| Figures | The 1–3 numbers that carry the answer, each linked to drill-down | Yes |
| Why | The causal explanation, 2–4 sentences | Yes |
| Assumptions | Explicit list of what the answer depends on | Yes |
| Confidence | High / Medium / Low with a one-line reason | Yes |
| Recommended action | What to do next, concrete | Where applicable |
| Show the work | Collapsed panel: query, period, source records, method | Yes |

**Question coverage for V1.** We commit to high-quality answers for these families and gracefully
decline outside them:

- Cash & liquidity — runway, payroll coverage, shortfall timing, balance projection
- Profitability — margin trend and decomposition, profit-by-customer/service/category
- Expenses — largest, fastest-growing, anomalies, recurring/subscription creep, vendor duplication
- Revenue — trend, concentration, retention, seasonality, forecast
- Scenarios — hiring, pricing change, customer loss, purchase, loan (see §5.6)
- Tax — estimated set-aside, quarterly obligation timing
- Receivables — who's late, aging, DSO, collection prioritization

**Out-of-scope handling.** For questions outside coverage (legal, HR, "should I sell my company"),
the model says so plainly and offers the nearest thing it *can* answer. Refusing well is a feature;
a confident answer to a question we can't ground is the single worst outcome in this product.

**Requirements**
- P50 response < 4s, P95 < 12s for the common families; streaming with visible reasoning steps so
  perceived latency stays low
- Every answer stores its full trace (plan, queries, results, model version, prompt hash) for audit
  and eval replay
- Answers are shareable via a link that renders the full trace, for the accountant persona
- Thumbs up/down on every answer, feeding the eval set

### 5.2 Cash Flow Forecasting — *the wedge*

**Output.** A 13-week daily cash projection with a confidence band, plus named risk events.

**Method.** Deliberately a hybrid, not a single model:

- **Committed items** (scheduled payroll, known recurring vendors, loan payments, rent, confirmed
  invoices with due dates) are projected deterministically. This is the bulk of the signal and
  requires no ML.
- **Uncollected receivables** are timed using the customer's own historical payment behavior
  (per-customer empirical distribution of days-late), not the invoice due date. This single choice
  is the biggest accuracy driver and the most common thing naive forecasters get wrong.
- **Variable / discretionary spend** is projected from a seasonal decomposition of the last 24
  months, falling back to trailing averages under 12 months of history.
- **New revenue** uses pipeline data where a CRM is connected; otherwise a seasonally-adjusted
  trailing model with a widened band.

We explicitly do **not** start with a learned end-to-end model. It would be worse, unexplainable,
and cold-start-broken. Once we have 1,000+ businesses and observed outcomes, a learned residual
correction on top of the structural forecast is the right V2 (see
[AI CFO Engine §8](../03-engineering/ai-cfo-engine.md#8-the-forecast-accuracy-flywheel)).

**Accuracy commitment.** We publish our own accuracy back to the user: "Our 30-day cash forecast for
your business has been within 6% for the last 4 months." Publishing accuracy is a trust weapon and
a forcing function. It also means we must measure it from day one — every forecast is snapshotted
and later scored against actuals.

**Requirements**
- Daily granularity, 13-week horizon, recomputed nightly and on material data change
- P10/P50/P90 band, not a single line
- Named risk events surfaced as objects, not just a dip in a chart: `PayrollShortfall`,
  `TaxObligation`, `LargeExpenseDue`, `CustomerConcentrationGap`
- Every point in the projection is explainable: "why is Nov 15 low?" → the contributing items

### 5.3 Business Health Score

**Honest framing:** a composite score is a *communication device*, not an analytical breakthrough.
Its job is to give a non-financial user a single thing to watch and improve. It earns its place only
if it's transparent and actionable; an opaque 0–100 number is astrology.

**Design**
- 0–100, composed of six weighted sub-scores: Liquidity (25), Profitability (20), Growth (15),
  Efficiency (15), Risk Concentration (15), Financial Hygiene (10)
- Each sub-score is computed from named, published ratios benchmarked against the business's own
  history first and industry peers second
- The UI always shows *the one change that would move the score most*, with the point delta
- Peer benchmarking is gated until we have ≥30 businesses in a NAICS-code × revenue-band cell, to
  avoid publishing noise. Below that threshold we show self-comparison only and say so.

**Requirements**
- Recomputed daily; history retained so the trend line is real
- Full breakdown always one click away; no black box
- Score changes >5 points trigger an explanatory notification

### 5.4 Smart Alerts

**The governing constraint is the false-positive budget.** An alert system that cries wolf is worse
than no alert system, because it destroys the channel we need for the one alert that matters.

**Rules**
- Maximum 2 proactive alerts per week per business under normal conditions
- Every alert must clear a materiality threshold *relative to that business* (e.g. an expense spike
  alert requires the anomaly to exceed both 2.5σ and 3% of monthly opex)
- Alerts are ranked and the top-N sent; the rest accumulate in the weekly brief
- Every alert carries a suggested action and a "this was not useful" control that tunes thresholds
- Critical class (payroll shortfall, projected negative balance, tax deadline) bypasses the cap and
  can go to SMS

**Alert catalog (V1):** payroll at risk · projected cash shortfall · large expense due without
coverage · revenue decline vs. trend · expense anomaly · margin compression · key customer payment
overdue · customer concentration breach · subscription/vendor creep · estimated tax obligation
approaching · runway below threshold.

### 5.5 Financial Dashboard

Single scrollable page, not a grid of 20 widgets. Order is fixed and opinionated:

1. **The answer bar** — the three things that matter right now, in sentences ("Cash is healthy for 7
   months. One risk: Nov 15 payroll. Margin down 3pts, driven by subcontractor cost.")
2. **Cash** — current, projected 13 weeks with band, runway
3. **Profit** — trailing 12 months with the current month's decomposition
4. **Revenue** — trend, MRR/ARR where subscription data exists, concentration
5. **Working capital** — AR aging, AP due, DSO
6. **Efficiency** — burn, CAC/LTV/churn *only when the connected data supports them honestly*

**On the requested metric list:** MRR, ARR, CAC, LTV, and churn are only meaningful for subscription
and e-commerce businesses. For an agency or a contractor they are misleading, and showing a
fabricated CAC teaches the user to distrust everything else. The dashboard adapts to the business
model detected during onboarding. Metrics we cannot compute honestly are *absent*, not zero, and
absent with an explanation of what to connect to enable them.

### 5.6 Scenario Planning

**Interaction:** natural language first ("what if I hire a senior developer at $140K?"), with a
structured editor for refinement. Scenarios are saved objects that can be compared and revisited.

**Scenario library (V1):** hire · terminate · raise prices · lose a customer · win a customer ·
purchase equipment (cash vs. finance) · take a loan · open a location · cut a cost category ·
change payment terms.

**Modeling quality is the differentiator here.** A naive tool subtracts salary from cash. A CFO
models: fully-loaded cost (salary × ~1.25–1.4 for taxes, benefits, equipment, software), a ramp
period before productivity, the revenue lift with a lag and a confidence range, the change in
runway, and the break-even month. Getting *this* right is worth more than ten extra integrations.

**Output:** side-by-side base vs. scenario on cash, runway, profit, and health score; the break-even
point; the biggest risk in the scenario; and an explicit statement of every assumption with the
ability to edit each one and see the result update.

### 5.7 AI Reports

Generated documents: weekly brief, monthly review, quarterly review, board/investor update, tax
summary, expense review.

**The weekly brief is the most important artifact in the product** — it's the habit loop. Monday
7am, email plus in-app: what happened, what changed, what to do this week, what's coming. Five
bullets, under 200 words, each drilling into the product. Optimize opens and click-through as a
top-line retention metric.

**Investor updates** pull a real differentiator: we can generate the metrics section *and* the
narrative from actual data, in the founder's own voice once we have a few samples. Board reports get
the accountant-grade treatment: every number footnoted to source.

All reports export to PDF, and to Google Docs / Notion where connected, so they can be edited before
sending. Never send anything on the user's behalf without explicit confirmation.

---

## 6. Success metrics

**North star:** *Weekly Active Businesses Taking Action* — businesses that, in a given week, either
acted on a recommendation, ran a scenario, or engaged with an alert. Not logins. Not questions
asked. Action is the only signal that we replaced judgment rather than added a toy.

| Metric | 6-month target | 18-month target | Why this number |
|---|---|---|---|
| Activation (connected + first insight within 24h) | 55% | 70% | Below 50% the onboarding is broken, not the product |
| Week-4 retention | 45% | 60% | The known killer for AI point tools; if we can't beat 45% the wedge is wrong |
| Weekly brief open rate | 45% | 55% | Proxy for whether the habit loop took |
| Answers rated helpful | 80% | 90% | Below 80% means grounding or coverage is failing |
| 30-day cash forecast MAPE | <10% | <6% | This is the product's core claim; it must be measured publicly |
| Net revenue retention | 100% | 115% | Expansion via seats and the firm tier |
| Gross margin | 70% | 80% | Inference cost must fall as a share of revenue, not rise |

**Counter-metrics we watch to catch ourselves lying:** alert dismissal rate (>30% means we're
spamming), answer regeneration rate (>15% means answers are wrong or unclear), and drill-down rate
on figures (a *rising* rate means users don't trust us yet — it should fall over a user's lifetime).

---

## 7. Requirements summary

**Functional**
- Connect QuickBooks Online, Plaid bank accounts, and Stripe; sync on schedule and on webhook
- Normalize into a unified financial model with full lineage to source records
- Compute the metric catalog deterministically, with period-over-period comparison
- Answer natural language questions with the answer contract in §5.1
- Produce and score a 13-week cash forecast nightly
- Evaluate alert rules and deliver via in-app, email, and SMS respecting the FP budget
- Run and save scenarios; compare against base
- Generate the report set on schedule and on demand
- Multi-user access with roles; multi-business access for the firm tier

**Non-functional**
- P95 page load < 1.5s; P95 chat answer < 12s
- 99.9% uptime target for the app; sync failures degrade gracefully with visible data-freshness state
- All data encrypted at rest and in transit; tenant isolation enforced at the database level
- Complete audit log of data access and every AI answer
- SOC 2 Type II readiness by month 12
- Designed for 10,000 businesses without re-architecture; the path to 100,000 is documented

---

## 8. Open questions

1. **Do we require QuickBooks/Xero, or can we serve bank-only businesses?** Bank-only means no
   accrual view, no customer-level profit, no AR — a much weaker product. Recommendation: allow
   bank-only signup with a clearly reduced feature set, but don't market to it. Needs validation.
2. **Where is the price ceiling for the owner persona?** Modeled at $199 in
   [pricing](../04-business/pricing.md), but this is the highest-variance assumption in the plan.
3. **Do we let the AI take actions** (pay a bill, move money, send a collection email) or stay
   advisory? Advisory in V1 is correct. The moment we act, we inherit liability and regulatory
   surface. Revisit with a human-in-the-loop confirmation model in Phase 3.
4. **How much do we invest in books hygiene?** Bad categorization in QuickBooks degrades every
   output. Options: detect and nag, auto-suggest fixes, or write corrections back. Write-back is
   powerful and dangerous. Start with detect-and-surface.

---

## 9. Appendix: the ten questions, mapped

The founding question list, mapped to the capability that answers it and the release that ships it.

| Question | Capability | Release |
|---|---|---|
| Can I afford to hire another employee? | Scenario: hire | V1.1 |
| Why did my profit decrease this month? | Margin decomposition | V1.0 |
| Which expenses should I reduce first? | Expense ranking + benchmark | V1.1 |
| Will I have enough cash to cover payroll? | Forecast + payroll risk | **V1.0 (wedge)** |
| How much should I set aside for taxes? | Tax estimator | V1.1 |
| Which customers generate the highest profit? | Customer profitability | V1.1 (requires clean job costing) |
| What happens if revenue drops 20%? | Scenario: revenue shock | V1.1 |
| Should I finance equipment or pay cash? | Scenario: finance vs. cash | V1.2 |
| How many months of runway do I have? | Runway calc | **V1.0** |
| Where is my business leaking money? | Anomaly + subscription creep + vendor duplication | V1.2 |
