# The plan from here — five phases

[roadmap.md](roadmap.md) was written before a line of code existed. This is the same strategy
re-planned against what actually got built, and it replaces the near-term half of that document.
Phases 1–3 here sit inside what roadmap.md calls Phase 0 and Phase 1; the long-range shape of
roadmap.md still stands.

Every phase below carries a **kill criterion**, per that document's own rule: phases without them
are wishes.

---

## Where we actually are

Built and verified: canonical schema with enforced row-level security, envelope encryption, a
rate-limited QuickBooks adapter, resumable archive-then-checkpoint ingestion, normalization with
confidence-scored account mapping, a deterministic metric engine with provenance, a four-stream
13-week cash forecast, a dashboard with drill-down, and a static export of it.

Not built, and load-bearing:

| Gap | Why it matters |
|---|---|
| **No real books have ever gone through the pipeline** | Normalization has only seen data a generator built to be normalizable |
| **`forecasts` is never written to** | The table exists in `0005_canonical.sql`. Bet #6 says the flywheel is the moat, and it cannot be reconstructed retroactively |
| **Cash is a summed ledger, not a bank balance** | `cashPosition` sums transactions. In real books that is a reconciled figure, often weeks stale — and the wedge is cash-flow certainty |
| **No auth, no deployment** | Nobody outside this machine can use it |
| **No AI layer** | The namesake feature. Deliberately last — see Phase 4 |
| **`S3Archive` and `AwsKms` throw** | Fine on local disk; not fine holding someone else's data |

By roadmap.md's own Phase 0 exit criteria, one of four is met (the tenancy suite). The unmet one
that matters is *"a real business's QuickBooks + bank data reconciles to source-system totals."*

---

## What this plan assumes

1. **One full-time engineer.** Timings scale roughly linearly — part-time doubles everything.
2. **Access to at least one real QuickBooks company file in week 1.** This is the critical path.
   If it slips, Phase 1 does not start and no phase after it is real. Treat securing it as the
   first task, ahead of any code.
3. **A founder discovery track runs in parallel from week 1**, unblocked by engineering. It gates
   Phase 4 and de-risks Phase 5.

Week numbers are relative to kickoff.

---

## Phase 1 — Ground truth (weeks 1–3)

**Goal:** find out whether the pipeline survives real books, and start the flywheel clock.

1. **Forecast persistence first — it is two days and the clock is already running.** Write every
   generated forecast to `forecasts`; score it against actuals into `forecast_scores` as they
   arrive. Nothing else in this plan gets more expensive by waiting.
2. Intuit production OAuth app. Sandbox to shake out the plumbing, then a real company file.
3. **The reconciliation harness — this is the actual deliverable.** Not "it synced," but "it
   agrees": canonical totals compared against QuickBooks' own P&L and Balance Sheet, per account,
   per month, with the diff reported.
4. Fix what it finds. Budget most of the three weeks here. Expect the account mapper's sub-0.7
   confidence flags to fire far more than they do on synthetic books.

**Exit criteria**
- Revenue, COGS, opex, and net income match QuickBooks' P&L for 12 months, to the cent, on at
  least one real company
- Balance-sheet cash matches QuickBooks' cash
- Every forecast generated since day one is persisted, with scoring running

**Kill criterion:** if a real company's books cannot be reconciled after three weeks of work, the
normalization problem is larger than scoped. Stop and re-scope before building anything on top of
it — this is the failure mode that quietly invalidates every number downstream.

**Excluded on purpose:** UI work, AI, deployment.

**Founder track, in parallel:** five discovery calls, at least two of them accounting firms — one
firm conversation can solve both the channel test (bet #4) and the real-books bottleneck at once.
Wizard-of-Oz the ten questions from the founding brief: answer them by hand off the metric engine
and send them. The reactions tell you which question shapes Phase 4 should support.

---

## Phase 2 — Trustworthy cash (weeks 4–8)

**Goal:** the cash number is the real bank balance, and divergence is caught without a human
looking.

1. Plaid connector — adapter, Link flow, transactions and balances. Reuses the existing HTTP
   client, archive, and checkpoint machinery; that generality is why it was built.
2. **Balance anchoring:** the forecast starts from an actual bank balance, not a summed ledger.
3. **Transfer matching across QuickBooks ↔ bank.** The classic killer: the same dollar arrives
   twice through two connectors and every metric double-counts.
4. Nightly reconciliation sweep, proven by an injected-divergence test.
5. Golden fixtures: freeze the anonymized real company alongside the synthetic agency as
   exact-equality fixtures in CI.

**Exit criteria**
- Cash position equals the bank balance
- Injected divergence is caught by the sweep within one night
- Golden fixtures 100% exact-match, blocking in CI

**Kill criterion:** if cross-source transfer matching cannot clear ~95% without hand-written rules
per customer, per-customer margin breaks and every metric is suspect. Re-scope the connector
strategy before adding a third source.

**Excluded on purpose:** more integrations, AI, anything cosmetic.

---

## Phase 3 — The wedge, in front of people (weeks 9–15)

**Goal:** design partners get value without a founder in the room. Deployment is justified here and
not before — the trigger is partners needing access between calls, not the feeling that a product
should be online.

1. Auth and app-layer multi-tenancy: orgs, users, roles, sessions. RLS already sits underneath.
2. Hosted deployment. Note that only `infra/modules/database` exists — network, compute, secrets,
   and storage modules are still to write, along with real `S3Archive` and `AwsKms`.
3. Onboarding: connect flow, chart-of-accounts confirmation, progressive reveal.
4. Alert rules — payroll shortfall and cash shortfall — under the materiality and false-positive
   framework.
5. Delivery: email and in-app. SMS for critical only.
6. The weekly brief.

**Exit criteria**
- 10+ design partners connected self-serve and receiving weekly briefs
- Weekly brief open rate above 50% at week 6
- Payroll risk correctly detected on at least three real businesses, with the false-positive rate
  recorded rather than estimated
- Tenancy suite still green and blocking; zero cross-tenant incidents

**Kill criterion:** if brief open rates collapse by week 6, the wedge is wrong. That is a
product-thesis failure, not a marketing one, and no feature work fixes it. Stop and re-examine
[PRD §2.1](../01-product/prd.md#21-the-wedge).

**Excluded on purpose:** chat, scenario planning, the health score.

---

## Phase 4 — The AI CFO (weeks 16–23)

**Goal:** plain-English questions answered from verified numbers — on the question shapes people
actually ask, which the Phase 1 founder track will have identified.

It is fourth, not first, for one reason: a narrator is only as honest as the engine beneath it.
Shipping it before Phase 1 means confidently narrating numbers nobody has checked against real
books, which is precisely the failure bet #1 exists to prevent.

1. Planner → executor → verifier → narrator, scoped to the proven question shapes.
2. Slot-reference grounding: the model may reference computed values and may not emit a figure of
   its own.
3. Eval suite: golden question/answer pairs over the fixtures, exact-match on every number.
4. Refusal as a first-class outcome — `insufficient_data` and "I can't answer that from your data"
   are correct answers.
5. Cost per conversation, measured against the gross-margin model in
   [pricing.md](../04-business/pricing.md).

**Exit criteria**
- Eval suite green and blocking; zero model-authored arithmetic, tested adversarially the way the
  tenancy suite is
- Every answer resolves to source transactions
- Median cost per conversation inside the pricing model
- Design partners asking questions unprompted, week over week

**Kill criterion:** if grounding cannot hold numeric hallucination at effectively zero, ship the
alerts product without chat. A CFO that lies once is worth less than no CFO. Bet #1 is the company.

**Excluded on purpose:** voice, general-purpose analytics, any question shape the discovery track
did not surface.

---

## Phase 5 — Charge money (weeks 24–30)

**Goal:** prove someone pays, and that the unit economics survive it.

1. Billing: Stripe, plans, trials, dunning.
2. Price test across the design-partner cohort.
3. Firm workspace — multi-client switching, the channel from bet #4.
4. The Stripe *connector* (revenue data), distinct from Stripe billing.
5. SOC 2 Type I preparation begins. It is the gate for firms and any customer above roughly 50
   employees; see [compliance.md](compliance.md) for what not to chase yet.

**Exit criteria**
- Design partners converting at list price without a discount
- CAC and payback measured against the [go-to-market](../04-business/go-to-market.md) targets
- At least one accounting firm bringing five or more clients
- Forecast accuracy visibly improving in `forecast_scores` — the flywheel, observed rather than
  asserted

**Kill criterion:** if partners who use it weekly still will not pay $99–$499, the value is real
and the price or the buyer is wrong. Re-examine [pricing.md](../04-business/pricing.md) and the
segment before spending anything on acquisition.

---

## The one structural risk in this plan

Everything hangs on getting a real QuickBooks company file in week 1. There is no engineering
workaround: synthetic data cannot falsify a normalization layer, because the generator and the
normalizer share assumptions. If no file is available, the honest move is to say so and re-plan —
not to keep building on numbers nobody has checked.
