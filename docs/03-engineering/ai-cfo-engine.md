# The AI CFO Engine

**This is the core IP of the company.** Everything else in the stack is table stakes that a competent
team can replicate in a quarter. This is the part that is hard, that compounds, and that determines
whether users trust us.

---

## 1. The problem statement, precisely

We need a system that takes an ambiguous natural-language question about a business's finances and
returns an answer that is:

- **Numerically exact.** Not approximately right. A CFO who is off by 8% on a payroll projection is
  fired.
- **Causally correct.** "Profit fell because of X" must actually be because of X, not a correlated
  line item.
- **Appropriately hedged.** Confident where the data supports confidence, explicitly uncertain where
  it doesn't, and willing to say "I can't answer that with the data you've connected."
- **Actionable.** Ends with what to do, not what happened.
- **Auditable.** Every claim traceable to source records, reproducible months later.

An LLM alone satisfies none of these reliably. An analytics engine alone satisfies the first and
fifth but cannot handle the ambiguity of natural language or produce judgment. The engine is the
composition of the two, with the boundary drawn in a specific place.

---

## 2. The central constraint: the model never computes

> **The LLM has no arithmetic authority. It cannot produce a number that did not come from the metric
> engine.**

This is enforced mechanically, not by prompting. The narrator does not write "$14,200" — it writes a
slot reference, and the renderer substitutes the verified value:

```
Narrator output:  "You'll be short {{fig:payroll_gap}} for the {{date:payroll_date}} payroll,
                   because {{fig:ar_expected}} of expected receivables land after that date."

Verified values:  payroll_gap   = MetricResult(-1420000, USD_cents, provenance: [...])
                  payroll_date  = 2026-11-15
                  ar_expected   = MetricResult(3810000, USD_cents, provenance: [...])

Rendered:         "You'll be short $14,200 for the Nov 15 payroll, because $38,100 of expected
                   receivables land after that date."
```

Any bare numeral in narrator output that is not a slot reference is a **grounding violation**. The
verifier catches it, the response is regenerated, and the violation is logged as a production metric.
Persistent violations on a prompt version block its rollout.

**Why this is worth the engineering cost.** In a consumer chat product, a hallucinated number is
embarrassing. In a financial product, it is terminal — the user finds one wrong number, and every
other number in the product becomes suspect forever. There is no recovery from that, and no amount
of "AI can make mistakes" disclaimer buys it back. So we make the failure mode structurally
impossible rather than statistically unlikely.

---

## 3. Pipeline

```
   Question
      │
      ▼
┌──────────────┐   Is this answerable? Which family? What entities, periods, filters?
│  CLASSIFIER  │   Fast model. Cheap. Routes everything downstream.
└──────┬───────┘
       ▼
┌──────────────┐   Produce a typed AnalysisPlan: which metrics, what grain, what
│   PLANNER    │   comparisons, what decomposition, what the answer needs to contain.
└──────┬───────┘   Frontier model, constrained output schema.
       ▼
┌──────────────┐   Run the plan against the metric engine. Pure code, no model.
│   EXECUTOR   │   Parallel where possible. Every result carries provenance.
└──────┬───────┘
       ▼
┌──────────────┐   Draft the answer against the answer contract, using slot
│   NARRATOR   │   references for every figure. Frontier model.
└──────┬───────┘
       ▼
┌──────────────┐   Grounding check, claim check, contract check, safety check.
│   VERIFIER   │   Mostly deterministic; one model-based claim check.
└──────┬───────┘
       ▼
   Rendered answer + full trace persisted
```

### 3.1 Classifier

Fast, cheap model. Outputs a typed struct:

```ts
type Classification = {
  answerable: boolean;
  family: 'cash' | 'profitability' | 'expenses' | 'revenue' | 'scenario'
        | 'tax' | 'receivables' | 'meta' | 'out_of_scope';
  entities: { customers?: string[]; vendors?: string[]; categories?: string[] };
  period: PeriodSpec;              // resolved from "last month", "this quarter", "since June"
  comparison?: PeriodSpec;
  requiredSources: SourceType[];   // what data must be connected to answer this
  complexity: 'lookup' | 'analysis' | 'reasoning';  // drives model routing downstream
};
```

Two important jobs beyond routing:

- **Data-requirement gating.** If the question needs accounting data and only a bank is connected,
  we short-circuit with an honest answer plus a connect prompt. We do not attempt a degraded answer
  and hope.
- **Cost routing.** A `lookup` question ("what was revenue last month?") skips the planner entirely
  and goes straight to a metric call plus a templated narration. This is a large fraction of real
  traffic and should never touch a frontier model.

### 3.2 Planner

Takes the classification and the org's data profile, and emits a typed `AnalysisPlan`. It does not
see raw financial data — it sees the *metric catalog schema*, the available dimensions, and metadata
about data coverage. This keeps the planning prompt small, cacheable, and stable.

```ts
type AnalysisPlan = {
  steps: PlanStep[];              // metric calls, decompositions, comparisons, forecasts
  answerShape: {
    headlineNeeds: SlotRef[];     // which figures the headline requires
    causalAnalysis: boolean;      // does this need a driver decomposition?
    scenarioSim?: ScenarioSpec;
    recommendationExpected: boolean;
  };
  assumptions: AssumptionRef[];   // which assumptions this analysis will depend on
};
```

**Why a plan rather than free tool-calling.** Free-form ReAct loops are flexible but unbounded: they
vary in cost, can loop, and are hard to test. An explicit plan is inspectable, cacheable per
question-shape, replayable in evals, and bounded in cost. When a question recurs across the user base
("why did profit drop?"), we reuse the validated plan rather than re-deriving it. Over time, the most
common plans become library plans that skip the planner entirely — a compounding cost and quality
advantage.

Plans that fail validation (referencing an unavailable metric, requesting a grain the data doesn't
support) are rejected before execution and retried once with the error as context.

### 3.3 Executor

Pure code. Runs plan steps against the metric engine, parallelizing independent steps. Enforces a
compute budget. Returns a `ResultSet` where every value is a `MetricResult`:

```ts
type MetricResult = {
  value: Decimal;
  unit: Unit;                    // USD_cents | ratio | days | count
  period: Period;
  confidence: Confidence;
  provenance: {
    metricKey: string;
    engineVersion: string;
    sourceRecordIds: string[];   // drill-down target
    computedAt: Date;
    dataFreshness: Record<SourceType, Date>;
  };
};
```

The executor also runs **coverage checks**: if a metric's underlying data is thin (fewer than N
records, less than the required history), it returns a degraded result with lowered confidence rather
than a confident number computed from noise.

### 3.4 Narrator

Frontier model. Receives the results, the answer contract, the user's business context (industry,
size, model), and their financial-literacy setting. Produces the structured answer with slot
references.

Prompt design principles that matter here:

- **The contract is a schema, not a suggestion.** Output is validated against a Zod schema; malformed
  output is regenerated, not patched.
- **Explicitly instruct on hedging calibration.** The failure mode is not just overconfidence — it's
  also mush. "Revenue may have possibly declined somewhat" is useless. Give the model the confidence
  level as an *input* from the engine and instruct it to write with that level of conviction.
- **Voice is a product decision, encoded in the prompt.** See [brand §4](../02-design/brand-identity.md#4-voice).
  Direct, plain, no jargon, no cheerleading, no apologizing.
- **Recommendations must be specific and bounded.** "Reduce expenses" is banned. "Cancel the 3 unused
  software subscriptions totaling {{fig:x}}/mo" is the standard.

### 3.5 A note on what the model is actually good for here

It's worth being precise, because it shapes where we invest. The model is doing three things that
code cannot:

1. **Disambiguation** — mapping "how are we doing?" to a specific, defensible analysis
2. **Causal narration** — turning a decomposition table into "subcontractor cost on the Vertex
   account outpaced billing" 
3. **Judgment framing** — knowing that a 4-point margin drop matters more for a 12%-margin business
   than a 60%-margin one, and saying so

Everything else — the math, the retrieval, the aggregation, the ranking — is code, and should be.

---

## 4. Grounding: how a claim becomes trustworthy

Four mechanisms, layered:

1. **Slot substitution** (§2) — numbers cannot originate in the model.
2. **Provenance chains** — every slot resolves to a `MetricResult` carrying source record IDs. Click
   any figure in the UI and see the transactions behind it. This is the single most trust-building
   interaction in the product, and it's why lineage is mandatory in the data layer.
3. **Assumption surfacing** — the engine emits assumptions as typed objects (`ar_timing_from_history`,
   `no_new_hires_assumed`, `seasonality_from_24mo`), and the narrator must render them. The user can
   edit an assumption and see the answer recompute.
4. **Confidence derived from data, not vibes** — computed from history depth, data freshness, variance
   in the underlying series, and completeness of connected sources. The model reports it; it does not
   decide it.

---

## 5. The verifier

Runs on every answer before it reaches the user. Four checks:

| Check | Method | On failure |
|---|---|---|
| **Grounding** | Regex + AST scan for bare numerals, dates, and percentages outside slot refs | Regenerate (max 2), then fall back to a structured non-prose rendering |
| **Contract** | Zod schema validation of the answer object; required slots present | Regenerate |
| **Claim consistency** | Model-based check: does each stated causal claim follow from the result set? Directional claims ("increased") checked deterministically against the values | Flag; downgrade confidence; regenerate if severe |
| **Safety** | Detect advice requiring a license (tax filing positions, securities, legal), detect overclaiming | Rewrite with the appropriate hedge and referral |

The directional check is cheap and catches a real class of error: the model writing "revenue grew"
when the computed delta is negative. Comparing every comparative adjective against the sign of the
corresponding computed delta is deterministic and should never be skipped.

**Latency cost** of verification is ~200–400ms, mostly the claim check. Worth it. The grounding and
contract checks are sub-millisecond.

---

## 6. Forecasting

The forecast is a separate subsystem the engine calls; it is not model-generated. Design rationale is
in [PRD §5.2](../01-product/prd.md#52-cash-flow-forecasting--the-wedge). Implementation notes:

**Decomposition into four streams**, each with its own method and its own uncertainty:

| Stream | Method | Uncertainty source |
|---|---|---|
| Committed outflows (payroll, rent, loans, scheduled recurring) | Deterministic schedule projection | Near zero; timing only |
| Receivables | Per-customer empirical payment-lag distribution, applied to open invoices | Distribution variance; widens with thin history |
| Variable spend | STL seasonal decomposition over 24mo; trailing mean under 12mo | Residual variance |
| New revenue | Pipeline-weighted where CRM connected; else seasonal trend | Largest band contributor |

Streams are combined with a Monte Carlo simulation (10K paths, sampling each stream's distribution)
to produce P10/P50/P90. Monte Carlo rather than analytic composition because the streams aren't
independent (a bad month correlates across revenue and receivables) and we want to model that
correlation explicitly.

**Per-customer payment-lag modeling is the highest-leverage detail in the whole forecast.** Naive
tools project invoices at their due date. Real businesses have customers who reliably pay at net-52
on net-30 terms. Modeling that per-customer is the difference between a forecast that's directionally
useless and one that catches a shortfall three weeks out.

**Cold start.** A business with 3 months of history gets a forecast with a wide band and an explicit
statement that accuracy improves with history. We do not hide thin data behind a confident-looking
line. We do not refuse either — a wide honest band still catches the big risks.

---

## 7. Evaluation

The eval system is the difference between shipping AI features and running an AI product. It has four
tiers.

### Tier 1 — Golden financial fixtures (deterministic, every commit)

A set of synthetic businesses with fully known books: a 22-person agency, a Shopify store with
seasonality, a contractor with heavy WIP, a SaaS company with deferred revenue, and a business with
deliberately messy books. For each, ~200 questions with hand-verified correct numeric answers.

The assertion is exact: for question Q on fixture F, the engine's computed figure must equal the
known-true value. **This tier tests the metric engine, not the model, and it must be 100% green,
always.** Any failure here is a P0.

### Tier 2 — Answer quality (on prompt/engine change)

The same questions, evaluated on the *answer*, not just the number:

- Grounding violation rate (target: 0)
- Contract compliance (target: 100%)
- Claim accuracy — judged by a model rubric plus periodic human review
- Hedging calibration — is confidence appropriate given the fixture's data thinness?
- Actionability — does the recommendation pass a specificity bar?

Gate: no regression on any metric, grounding violations at zero, to ship a prompt change.

### Tier 3 — Forecast accuracy (continuous, production)

Every forecast is snapshotted. As actuals arrive, we score MAPE at 7/30/90 days, per business and
fleet-wide, sliced by history depth and connected sources. This is both a quality metric and a
product feature (we publish it to users) and the input to the flywheel in §8.

### Tier 4 — Human review (weekly)

A sampled set of real production answers reviewed by someone who knows accounting. Non-negotiable
and unglamorous. Automated evals catch regressions against known cases; only a human catches "this
answer is technically correct and completely misses the point." Findings become Tier 1/2 cases.

**Every thumbs-down in production becomes an eval candidate.** The triage pipeline from user feedback
to eval case to fix is a core internal workflow, staffed from day one.

---

## 8. The forecast-accuracy flywheel

This is the answer to "what stops Intuit from doing this?"

```
More businesses → more observed forecast-vs-actual pairs
       ↓                                      ↑
Better residual correction models       More retention
       ↓                                      ↑
More accurate forecasts ────────────→ More trust, more referrals
```

Concretely, once we have outcome data at volume:

- **Residual correction.** The structural forecast has systematic biases that vary by industry, size,
  and seasonality. A learned model that predicts the *error* of the structural forecast — trained on
  thousands of observed outcomes — corrects those biases while keeping full explainability, because
  the base forecast is still structural and decomposable.
- **Payment-behavior priors.** A new customer with no payment history gets a prior drawn from similar
  businesses in similar industries, rather than the useless assumption of on-time payment.
- **Benchmark intelligence.** "Your COGS is 8 points above similar-size agencies" is only possible
  with fleet data, and is one of the most requested things owners want.
- **Scenario calibration.** We eventually know what actually happened to businesses that made a
  similar hire. That turns scenario modeling from arithmetic into evidence.

**This compounds and cannot be bought.** It requires a multi-source view across many businesses plus
years of outcome observation. It is the reason to instrument forecast accuracy on day one even though
it produces no value for eighteen months.

---

## 9. Cost management

Unit economics are an engineering responsibility here, not a finance one. Levers, in order of impact:

1. **Tier routing** (§3.1) — the biggest lever. Target ≥60% of calls on the fast tier.
2. **Library plans** — recurring question shapes skip the planner. Target 40% of `analysis`-family
   questions on cached plans within a year.
3. **Prompt caching** — the metric catalog and contract are a large static prefix. Substantial
   savings for near-zero effort.
4. **Batch API** for reports and weekly briefs, which are not latency-sensitive.
5. **Answer caching** — identical question, same org, unchanged data → serve the cached answer with a
   freshness note.
6. **Response-length discipline** — the answer contract caps length. Shorter answers are both cheaper
   and better.

Per-org token spend is tracked and alerted on. A single power user on an unlimited plan can quietly
destroy the margin on a cohort; see [pricing §7](../04-business/pricing.md#7-cogs-and-gross-margin)
for how packaging handles this.

---

## 10. What we are not doing, and why

| Not doing | Why |
|---|---|
| Fine-tuning a base model on financial data | Our problem is grounding and orchestration, not domain knowledge. Frontier models already know accounting. Fine-tuning would lock us to a model version and buy little. |
| RAG over transactions | Embeddings cannot aggregate. See [architecture §10 / ADR-007](architecture.md#10-key-architectural-decisions-adr-summary). |
| Autonomous agent loops | Unbounded cost, unbounded latency, untestable. Explicit plans instead. |
| Letting the model write SQL against the raw DB | Tempting and demos well. Fails on correctness (subtly wrong joins produce plausible wrong numbers), on security, and on auditability. The metric catalog is the interface. |
| Taking financial actions | Advisory in V1. Acting means liability and regulatory surface. See [PRD §8](../01-product/prd.md#8-open-questions). |

The "let the model write SQL" item deserves the extra sentence: it will be proposed by someone every
six months because it appears to solve the coverage problem for free. It doesn't. A model-written
query that joins invoices to payments incorrectly returns a number that looks entirely reasonable and
is wrong, with no signal that anything failed. The metric catalog exists precisely so that the space
of possible computations is one we have tested.
