# Testing & Quality

Two problems make testing here unusual: **financial correctness has no tolerance band**, and **part
of the system is non-deterministic**. Standard test pyramids don't address either.

---

## 1. The three tests that actually matter

Before the general strategy — if we could only run three suites, these are them, because each guards
a failure that ends the company rather than causing a bug report.

### 1.1 Golden financial fixtures

A set of synthetic businesses with fully-known books, and hand-verified correct answers for every
metric in the catalog.

| Fixture | Shape | What it catches |
|---|---|---|
| `agency-22` | 22-person services business, project billing, subcontractors | Customer profitability, job costing, accrual vs. cash divergence |
| `shopify-seasonal` | E-commerce, heavy Q4, inventory, refunds | Seasonality, COGS timing, refund handling |
| `saas-deferred` | Subscription, annual prepay, deferred revenue | Revenue recognition, MRR/ARR, churn |
| `contractor-wip` | Construction, retainage, work-in-progress, progress billing | Long-cycle revenue, WIP, milestone timing |
| `messy-books` | Miscategorized, duplicate entries, unreconciled transfers, a personal expense in the business account | Dedup, transfer matching, hygiene detection, graceful degradation |
| `thin-history` | 4 months of data only | Cold-start behavior, confidence downgrading, refusal to overclaim |

For each, ~200 questions with known-correct numeric answers. The assertion is **exact equality**, not
approximate. This suite tests the metric engine, not the model, and must be 100% green always. Any
failure is a P0.

`messy-books` and `thin-history` are the ones teams forget to build, and they catch the most. Clean
synthetic data validates the happy path that real customers never have.

### 1.2 Adversarial tenancy suite

Runs every repository method under tenant A's context against tenant B's data, asserting empty
results. Also asserts, before running, that the test role is `NOSUPERUSER` and `NOBYPASSRLS` —
without that precondition check, every case would pass for the wrong reason
([security §3](security.md#3-tenant-isolation--the-control-that-matters-most)).

Verified behaviors it locks in:
- Unscoped query with tenant context → only that tenant's rows
- Query explicitly naming another tenant's `org_id` → zero rows
- **No tenant context set → zero rows** (fails closed)

Blocking in CI with no override.

### 1.3 Grounding suite

Asserts that no model output reaches a user containing a number the engine didn't compute. Runs the
full answer pipeline over the fixtures and scans rendered output for numerics that don't resolve to a
`MetricResult`.

Target: zero violations. A nonzero rate blocks the prompt version from shipping
([ai-cfo-engine §5](ai-cfo-engine.md#5-the-verifier)).

---

## 2. General strategy

| Layer | Scope | Tool | Where we're strict |
|---|---|---|---|
| Unit | Metric functions, normalization, date/period math, money arithmetic | Vitest | 100% branch coverage on the metric catalog and money handling. Nowhere else has a coverage target. |
| Property-based | Money arithmetic, period boundaries, dedup, forecast invariants | fast-check | See §3 |
| Integration | Repositories, RLS, queue jobs, connector adapters | Vitest + Testcontainers | Real Postgres, never a mock |
| Contract | Connector adapters vs. recorded provider responses | Recorded fixtures | See §4 |
| E2E | Onboarding, ask-a-question, alert delivery, scenario | Playwright | Critical paths only — a large E2E suite is a maintenance tax that buys little |
| Eval | AI answer quality | Custom harness | [ai-cfo-engine §7](ai-cfo-engine.md#7-evaluation) |
| Load | Dashboard, batch metrics, nightly forecast fleet run | k6 | Before each scale milestone |

**We do not have a global coverage target.** Coverage percentages drive people to test getters. The
targeted 100% on the metric catalog and money handling is the part that matters; elsewhere, tests are
justified by risk.

---

## 3. Property-based testing

Financial code has invariants that example-based tests sample poorly. Worth the setup:

```ts
// Money never loses precision through a round trip
fc.assert(fc.property(fc.integer({ min: -1e12, max: 1e12 }), (cents) =>
  toMinorUnits(fromMinorUnits(cents)) === cents));

// Categorized expense always sums to total expense, for any transaction set
fc.assert(fc.property(arbTransactionSet(), (txns) =>
  sum(byCategory(txns).map(c => c.total)) === totalExpense(txns)));

// Deduplication is idempotent: running it twice changes nothing
fc.assert(fc.property(arbTransactionSet(), (txns) =>
  deepEqual(dedupe(dedupe(txns)), dedupe(txns))));

// Transfers never affect profit
fc.assert(fc.property(arbTransactionSet(), arbTransferPair(), (txns, pair) =>
  netProfit(txns) === netProfit([...txns, ...pair])));

// Forecast bands are ordered and contain the median, always
fc.assert(fc.property(arbForecastInputs(), (inputs) => {
  const f = forecast(inputs);
  return f.points.every(p => p.p10 <= p.p50 && p.p50 <= p.p90);
}));
```

The transfer invariant and the dedup-idempotence invariant have each caught the class of bug that is
otherwise found by a customer noticing their revenue is wrong.

---

## 4. Testing connectors without hitting providers

Provider APIs are rate-limited, occasionally down, and their sandboxes don't reflect real data mess.

- **Recorded fixtures.** Real (anonymized) responses captured once, replayed in tests. Includes the
  pathological cases: partial refunds, multi-currency, voided-then-reissued invoices, a QBO chart of
  accounts with 400 accounts and inconsistent naming.
- **Contract tests** run nightly against provider sandboxes to detect API drift. They don't block PRs
  — they open an issue. Blocking CI on a third party's uptime is how you learn to ignore CI.
- **Chaos cases** in integration tests: timeouts, 429s, malformed payloads, partial pages, webhook
  replays, and out-of-order delivery. Each connector must handle all of them, and these are the tests
  that make the degradation ladder in [deployment §5](deployment.md#5-reliability) real rather than
  aspirational.

---

## 5. Testing a non-deterministic system

The honest framing: **you cannot unit-test an LLM's output, and pretending otherwise produces flaky
suites that get disabled.** Instead, split the problem.

**What is deterministic and must be tested as such:**
- Classification routing (assert the *family* chosen, not the wording)
- Plan validity (does the produced plan reference real metrics at supported grains?)
- Execution (pure code — fully testable)
- The verifier itself (feed it known-bad narrations and assert rejection)
- Slot resolution and rendering

**What is statistical and must be measured, not asserted:**
- Answer quality, hedging calibration, actionability
- Measured over a fixture set with thresholds, tracked as a trend, gated on *regression* rather than
  on an absolute pass/fail

**What requires a human:**
- Weekly review of sampled production answers by someone who knows accounting. Automated evals catch
  regressions against known cases; only a person catches "technically correct, entirely misses the
  point." Every finding becomes a fixture case.

The practical consequence: CI gates on the deterministic parts and on *no regression* in the
statistical parts. It never gates on an LLM producing a specific string.

---

## 6. Continuous production quality

Testing doesn't end at deploy for a product like this.

| Signal | Threshold | Action |
|---|---|---|
| Forecast MAPE (30d, fleet) | > 10% | Investigate model; consider widening published bands |
| Grounding violations | > 0 | P0 |
| Answer thumbs-down rate | > 20% | Triage into eval cases within the week |
| Answer regeneration rate | > 15% | Answers are unclear or wrong — investigate |
| Reconciliation divergence | any | Page; likely silent connector breakage |
| Alert dismissal rate | > 30% | We're spamming; thresholds need tuning |

Every one of these is a quality signal that no pre-deploy test can produce, because they depend on
real data and real users. Instrumenting them is part of the definition of done for the relevant
feature, not a later addition.

---

## 7. Definition of done

A change is done when:

1. Tests exist at the appropriate layer, and the golden fixtures still pass exactly
2. If it touches tenancy, the adversarial suite covers the new access path
3. If it touches prompts or the engine, evals show no regression and zero grounding violations
4. Instrumentation exists for the production quality signals it affects (§6)
5. It degrades gracefully — the behavior when its data source is stale or absent is defined, not
   accidental
6. A runbook entry exists if it introduces a new failure mode
