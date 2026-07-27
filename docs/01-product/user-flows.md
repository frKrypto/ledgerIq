# User Flows

Twelve flows covering the product's real surface area. Onboarding has its own document
([onboarding.md](onboarding.md)); it's referenced here as Flow 1 for completeness.

Notation: `→` step · `⟂` decision · `✗` failure path · `◆` the moment that carries the flow

---

## Flow 1 — Onboarding to first insight

Full detail in [onboarding.md](onboarding.md). Summary:

```
Landing (question captured) → Signup → Profile (4 questions)
  → Connect accounting ⟂ declined → Demo mode on sample business → retry later
  → Connect bank ⟂ skipped → reduced feature set, stated explicitly
  → Progressive reveal during sync (true facts every ~60s)
  → Chart-of-accounts confirmation (ambiguous items only)
  ◆ Their original question, answered with their data
  → Alerts + weekly brief configured → ACTIVATED
```

---

## Flow 2 — Ask a question (the core loop)

The interaction the product is judged on.

```
Entry: chat surface, dashboard figure, alert, or a suggested follow-up
  → User types a question
  → Streaming stages appear: "Understanding…" → "Pulling your numbers…" → "Analyzing…"
     (real stages, not a fake spinner — they inform, and they cut perceived latency)
  ⟂ Question outside coverage
       → Honest decline + the nearest thing we CAN answer + optionally log for coverage
  ⟂ Required data not connected
       → "This needs your payroll data" + one-click connect + what it unlocks
  ⟂ Data too thin
       → Answer with explicit low confidence + what would improve it
  ◆ Answer renders: headline → figures → why → assumptions → confidence → action
  → User can: drill into any figure · edit an assumption · ask a follow-up
     · save to a report · share a link · rate it
```

**Three design decisions worth stating:**

- **Every figure is clickable**, down to source transactions. The drill-down rate should *fall* over
  a user's lifetime — a rising rate means we haven't earned trust yet, which is why it's a tracked
  counter-metric ([PRD §6](prd.md#6-success-metrics)).
- **Every assumption is editable**, and editing recomputes live. The intended interaction is the user
  *arguing* with the model. That's what they'd do with a real CFO.
- **Follow-ups are suggested, not required.** Three contextual next questions after each answer,
  because most users don't know what to ask second, and this is where the product teaches them what
  it can do.

---

## Flow 3 — Payroll risk alert (the wedge)

The flow that creates dependency. It must be excellent.

```
[Nightly] Forecast recomputes → payroll risk rule evaluates
  ⟂ Projected balance on pay date > payroll + buffer → no alert (silence is a feature)
  ⟂ Shortfall detected AND clears materiality threshold
      → Severity by lead time: <7 days = critical, 7–21 = high, >21 = medium
      → Critical bypasses the 2/week cap; may go to SMS
  ◆ Alert delivered: "Nov 15 payroll is $14,200 short."
      Body: why (which receivables land late, what's committed before then)
      Actions, each with estimated impact:
        · Collect: 3 overdue invoices totaling $38,100 → draft collection emails
        · Defer: 2 payable bills that could move past the 15th → $9,400
        · Finance: line of credit draw → cost estimate
        · Model it: open as a scenario
  → User acts ⟂ resolves → follow-up confirms: "Nov 15 payroll is covered."
                ⟂ dismisses → "not useful" tunes thresholds
                ⟂ ignores → re-alert at 7 days and 2 days if unresolved
```

**The resolution confirmation matters as much as the alert.** Closing the loop — "you were at risk,
you acted, you're now covered" — is what converts a scary notification into a reason to keep paying.
Without it, the alert is just anxiety.

---

## Flow 4 — Weekly brief (the habit loop)

```
[Monday 7:00 local] Generate → email + in-app + optional Slack
  Structure, ≤200 words:
    1. Headline state: "Cash is healthy. One thing needs attention this week."
    2. What changed: 2–3 bullets with figures
    3. What needs you: the action item, if any
    4. What's coming: next 14 days (payroll, large bills, tax dates)
    5. One question you should ask → deep link into chat
  → Open ⟂ click into product → session
          ⟂ read-only → still counts; the brief IS the product for many users
  → Track opens and CTR as a top-line retention metric
```

The fifth element — a suggested question — is the bridge from passive reading to active use, and it's
the highest-CTR element in the brief. Worth optimizing specifically.

---

## Flow 5 — Scenario planning

```
Entry: chat ("what if I hire?"), dashboard CTA, or from an alert
  → Natural language OR structured picker
  → Engine infers sensible defaults for everything unstated
  ◆ Result: base vs. scenario, side by side
      Cash curve overlay · runway delta · profit impact · break-even month
      · health score delta · the scenario's largest risk
  → ASSUMPTIONS PANEL — every one editable:
      burden multiplier 1.30 · ramp 3 months · revenue lift +$0 (conservative default)
      · start date · one-time costs
  → Edit any → live recompute
  → Compare up to 4 scenarios
  → Save · share · export to a report
```

**The default assumptions are a product opinion, and they should be conservative.** Defaulting
revenue lift from a new hire to zero, and requiring the user to assert otherwise, is the CFO-like
move: make the case for the cost first, let optimism be an explicit input. A tool that defaults to
optimistic assumptions is a tool that helps people make bad decisions confidently.

---

## Flow 6 — Investigating a change ("why did profit drop?")

```
Entry: dashboard anomaly, alert, or direct question
  → Decomposition runs: this period vs. comparison, ranked drivers
  ◆ "Profit fell $18,400 (−31%). 62% of that is subcontractor cost on the Vertex account,
     which grew 40% while billings on it were flat."
  → Ranked driver list, each expandable to transactions
  → "Is this a trend or a one-off?" → 6-month view of the top driver
  → Recommended action, specific to the driver
  → Follow-ups: "Is Vertex still profitable?" · "What if I reprice it?"
```

The chain from *symptom → cause → transaction → action* in four clicks is the flow that most clearly
separates us from a dashboard. A dashboard shows the symptom and stops.

---

## Flow 7 — Cash shortfall resolution

```
Forecast projects negative balance within 90 days
  ◆ "You're projected to go negative around Dec 3, about $22,000 short at the midpoint."
  → Contributing factors, ranked
  → Options with modeled impact and effort:
      Accelerate collections · defer payables · reduce discretionary spend
      · draw credit · delay a planned purchase
  → "Model a combination" → scenario with several levers
  → Track: does the projected gap close as they act?
  → Resolution confirmation when it clears
```

---

## Flow 8 — Month-end review

```
[Day 1 of month] Monthly report generated
  → Executive summary in plain language
  → P&L with prior-month and prior-year comparison
  → What changed and why (decomposition, not just deltas)
  → Health score movement, with the driver
  → Forecast update
  → Recommended focus for the coming month
  → Export PDF · push to Drive/Notion · share with accountant
  ⟂ Accountant on the account → they get it too, with drill-down enabled
```

---

## Flow 9 — Accountant multi-client console

The firm-tier flow. This is a genuinely different product surface, not a skin.

```
Login → Client list ranked by ATTENTION NEEDED, not alphabetically
   Each row: name · health score · runway · open critical alerts · data freshness
  ◆ "4 of your 47 clients need attention this week"
  → Filter: at-risk · data stale · score dropped · unreviewed
  → Click client → scoped session into that org (single-tenant scope, per security model)
  → Review, annotate, generate a white-labeled report
  → Return to console; annotations persist per client
  → Bulk: generate monthly reports for all clients → queued → notified when ready
```

**Design constraint from the security model** ([security §3](../03-engineering/security.md#3-tenant-isolation--the-control-that-matters-most)):
the console shows rollups; any transaction-level view requires an explicitly scoped session for one
client. This is slightly slower than a single unscoped query and it is not negotiable.

**The bulk report generation is the feature that sells the firm tier.** A firm partner spending 3
hours a month producing client reports manually will convert on that alone.

---

## Flow 10 — Connection breaks

Frequent enough to be a designed flow rather than an error state.

```
Sync fails ⟂ transient → retry with backoff, no user contact
            ⟂ auth expired / MFA change → user action required
  → Connection status → `reauth_required` (product-visible state, not a hidden error)
  → Data freshness indicator on every affected surface shows the as-of time
  → Affected answers state which figures are stale
  → Escalating notification: in-app → email at 24h → SMS at 72h if critical data
  ◆ Reconnect is TWO CLICKS from the notification, not a link to a settings page
  → On reconnect: gap backfill → "You're up to date. Here's what changed while disconnected."
```

The catch-up summary on reconnect turns a maintenance chore into a small moment of value.

---

## Flow 11 — Finding leaks ("where am I losing money?")

```
Question or dashboard entry
  → Parallel analyses:
      · Recurring/subscription creep — series with rising trend
      · Duplicate vendors — two tools doing the same job
      · Unused subscriptions — recurring charge, no matching usage signal
      · Price increases absorbed silently
      · Margin erosion by customer or service line
      · Categories growing faster than revenue
  ◆ Ranked findings with annual impact:
      "$4,200/yr — 3 subscriptions with no activity since March"
      "$11,000/yr — two overlapping design tools"
      "$31,000/yr — Vertex account margin fell from 34% to 11%"
  → Each: evidence · confidence · recommended action · dismiss-with-reason
  → Dismissals persist (don't re-surface what they've judged)
```

Dismissal-with-reason is important: the user knows things we don't ("that subscription is for a
client project"). Re-surfacing a dismissed finding is how a smart feature becomes an annoying one.

---

## Flow 12 — Tax set-aside

```
[Quarterly, ahead of deadlines] Estimate computed
  ◆ "Set aside about $18,400 for Q3 estimated taxes. Due Sept 15."
  → Basis: YTD profit, entity type, state, prior-year safe harbor
  → Assumptions shown and editable (entity type, state, deductions treatment)
  → ⚠️ Clear boundary: "This is an estimate to help you plan cash, not tax advice.
       Confirm with your accountant before filing."
  → Track set-aside vs. target over time
  → Alert if the projected balance won't cover it
```

**The disclaimer is a hard requirement, not a nicety.** We estimate to help plan cash; we do not
prepare or advise on tax positions. That line has legal weight
([compliance](../05-execution/compliance.md)), and the product must not blur it — including in how
the AI phrases answers, which is enforced by the verifier's safety check
([ai-cfo-engine §5](../03-engineering/ai-cfo-engine.md#5-the-verifier)).

---

## Cross-cutting patterns

Consistent across every flow:

| Pattern | Rule |
|---|---|
| **Data freshness** | Visible on every surface showing numbers. Never silently stale. |
| **Drill-down** | Every figure, everywhere, resolves to source records. |
| **Assumptions** | Always visible, always editable, recompute on change. |
| **Confidence** | Stated whenever we project or infer. |
| **Graceful absence** | Metrics we can't compute honestly are absent with an explanation — never zero. |
| **Action orientation** | Every insight ends in a recommended next step or explicitly notes none is needed. |
| **Loop closure** | When a flagged risk resolves, say so. Unclosed loops are just anxiety. |
| **Dismissal memory** | A dismissed finding stays dismissed, with its reason retained. |
