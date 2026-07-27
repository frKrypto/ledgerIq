# Analytics Plan

---

## 1. The four metrics that actually matter

Most analytics plans are a list of 60 events and no point of view. Start from the opposite end: if we
could see only four numbers, these are them.

| Metric | Definition | Why this one |
|---|---|---|
| **Weekly Active Businesses Taking Action** | Businesses that acted on a recommendation, ran a scenario, or engaged an alert in a given week | The north star. Logins measure curiosity; action measures whether we replaced judgment. |
| **Week-4 retention** | % of activated businesses active in week 4 | The known killer for AI point tools. Gates all acquisition spend. |
| **Forecast MAPE (30-day)** | Mean absolute % error, fleet-wide | The product's core claim. Also the moat, made measurable. |
| **CAC payback** | Months to recover blended acquisition cost | Determines whether growth is possible at all |

Everything else in this document exists to explain movement in these four.

**Deliberately not a top metric:** signups, page views, questions asked, or time in product. Each is
either a vanity metric or ambiguous. *Time in product* is actively misleading here — a user spending
20 minutes trying to understand their cash position means we failed. The good outcome is a 90-second
session that ends in a decision.

---

## 2. Event taxonomy

`object_action` naming, snake_case, past tense. Every event carries `org_id`, `user_id`,
`session_id`, `timestamp`, plus common context (plan tier, business model, days since activation,
connected sources).

### Acquisition & onboarding

```
landing_question_asked        { question_text, question_family }
signup_started                { method }
signup_completed
profile_completed             { naics, employee_band, revenue_band, accounting_software }
connect_started               { source }
connect_completed             { source, duration_ms }
connect_abandoned             { source, step }          ← the highest-value failure event
demo_mode_entered
sync_progress_reached         { milestone, elapsed_ms }
coa_confirmation_completed    { items_confirmed, items_ambiguous }
first_insight_delivered       { insight_type, time_since_signup_ms }
activated                     { time_to_activate_ms, sources_connected }
disqualified                  { reason }
```

`connect_abandoned` with its `step` is the single most valuable event in the taxonomy — it localizes
the drop at the point where the funnel actually breaks
([onboarding §4](../01-product/onboarding.md#4-activation)).

### Core product

```
question_asked                { family, complexity, entry_point, is_followup }
answer_delivered              { family, latency_ms, confidence, figure_count,
                                had_recommendation, model_tier, cost_usd }
answer_rated                  { rating, family, note_provided }
answer_regenerated            { family }                 ← counter-metric
figure_drilled_down           { metric_key, from_surface }
assumption_edited             { assumption_key, from_value, to_value }
answer_shared                 { channel }

alert_triggered               { rule_key, severity, materiality, lead_time_days }
alert_delivered               { rule_key, channel }
alert_opened                  { rule_key, channel, time_to_open_ms }
alert_action_taken            { rule_key, action_type }
alert_dismissed               { rule_key, reason }       ← counter-metric
alert_resolved                { rule_key, days_to_resolve, resolved_by_user_action }

brief_delivered               { week }
brief_opened                  { week, time_to_open_ms }
brief_link_clicked            { week, element }          ← the passive→active bridge

scenario_created              { kind, entry_point }
scenario_assumption_edited    { kind, assumption_key }
scenario_saved                { kind }
scenario_compared             { scenario_count }

forecast_viewed               { horizon, from_surface }
report_generated              { kind, on_demand }
report_exported               { kind, format }
```

### Data health

```
sync_completed                { source, records, duration_ms }
sync_failed                   { source, error_code }
connection_degraded           { source, reason }
reauth_required               { source }
reauth_completed              { source, time_since_required_ms }
data_quality_assessed         { uncategorized_pct, unreconciled_count, score }
reconciliation_diverged       { source, divergence_pct }
```

### Commercial

```
trial_started / trial_ended        { converted }
plan_selected / plan_changed       { from_tier, to_tier, direction }
subscription_cancelled             { reason, tenure_days }
user_invited / user_joined         { role }
accountant_invited                 { by_org }
firm_client_added                  { firm_id }
```

---

## 3. Metrics that watch us, not the user

The most valuable analytics in this product monitor **our own honesty**. These are counter-metrics —
each one rising means something is wrong with us.

| Counter-metric | Threshold | What it means |
|---|---|---|
| Answer regeneration rate | >15% | Answers are unclear or wrong |
| Alert dismissal rate | >30% | We're spamming; the false-positive budget is failing |
| Answer "incorrect" rate | >3% | Metric-layer problem, not a prompt problem |
| Grounding violations | >0 | P0 — the core architectural guarantee is breached |
| **Figure drill-down rate, rising over a user's tenure** | any sustained rise | **Users don't trust us.** Should *fall* as trust accumulates. |
| Reconciliation divergence | any | Silent connector breakage |
| Time-to-first-insight | >10 min | Onboarding is degrading |

The drill-down metric is the subtlest and most useful. Drill-down is a feature we're proud of, so the
instinct is to celebrate high usage. But a user who checks every number is a user who doesn't believe
us. The healthy pattern is high drill-down in week 1, falling steadily after — and a cohort where it
*doesn't* fall has a trust problem no survey would reveal.

---

## 4. Forecast accuracy instrumentation

Separate from product analytics because it's both a quality system and a strategic asset.

Every forecast is snapshotted at generation. As actuals arrive, `forecast_scores` records MAPE at
7/30/90 days plus whether the actual fell inside the P10–P90 band.

**Sliced by:** history depth, connected sources, business model, NAICS, revenue band, and **cohort
tenure**.

That last slice is the one that matters strategically. *Accuracy improving with tenure* is the
flywheel showing up as evidence rather than assertion, and it's the Series A proof point
([fundraising §4](../04-business/fundraising.md#4-traction-narrative-by-stage)). It must be
queryable, charted, and reviewed monthly from the first forecast we ever generate — the data cannot
be reconstructed retroactively.

**Band calibration** is checked separately: if actuals land inside the P10–P90 band far more than 80%
of the time, our bands are too wide and we're hedging rather than forecasting. Too rarely, and we're
overconfident. Both are failures; only one feels like one.

---

## 5. Tooling

| Layer | Tool | Note |
|---|---|---|
| Product analytics | PostHog, self-hosted initially | Financial-adjacent behavioral data shouldn't default to a third party; self-hosting is credible in security reviews |
| Warehouse | Postgres → ClickHouse when volume demands | Product events separate from the transactional store |
| BI | Metabase | Sufficient; don't buy a data stack for a 9-person company |
| LLM cost/quality | Braintrust or LangSmith | Per-org cost attribution and prompt tracing |
| Error monitoring | Sentry | |

**Hard rule: no financial data in analytics events.** Send `question_family`, never the figures.
Send `materiality_band`, never the amount. Analytics vendors are a different trust and retention
domain than the product database, and a transaction amount in a PostHog event is a data-handling
incident regardless of vendor posture.

`landing_question_asked` carries `question_text` deliberately and is the one exception — it's
pre-signup, contains no customer financial data, and is our most valuable content-strategy input
([marketing §4](../04-business/marketing.md#4-the-content-engine)). It should be reviewed for
inadvertent PII before retention.

---

## 6. Dashboards

**Daily (founders, 2 minutes):** new signups, activations, WABTA, alerts fired vs. acted on, grounding
violations, error rate.

**Weekly (team):** the four north-star metrics, funnel by step, counter-metrics, forecast accuracy
trend, top question families, negative-feedback queue.

**Monthly (board):** ARR/NRR, cohort retention curves, CAC/LTV by channel, forecast accuracy by
cohort tenure, firm channel performance, risk-register tripwires.

**Always-on alerting:** grounding violations, reconciliation divergence, activation-rate drop >10pp
week-over-week, and per-org LLM cost outliers.

---

## 7. Analysis cadence

- **Cohort retention** monthly, by acquisition channel and by connected-source count. The hypothesis
  worth testing early: businesses connecting 3+ sources retain materially better. If true, onboarding
  should push harder on the third connection.
- **Question-family analysis** monthly — what people ask drives the roadmap and the content engine.
- **Negative-feedback triage** weekly, into eval cases
  ([ai-cfo-engine §7](../03-engineering/ai-cfo-engine.md#7-evaluation)).
- **Alert efficacy** monthly: fired → opened → acted → resolved, by rule. Rules with low action rates
  get tuned or retired. An alert nobody acts on is worse than no alert.

---

## 8. Instrumentation discipline

- **Events are defined before the feature ships**, not after. Instrumentation is in the definition of
  done ([testing §7](../03-engineering/testing.md#7-definition-of-done)).
- **A schema registry** with typed event definitions; malformed events fail CI. Untyped analytics
  decays into unusable data within a year.
- **Every event has a stated purpose.** If nobody can say which decision an event informs, don't
  collect it. A taxonomy of 200 events nobody queries is worse than 40 that are trusted.
