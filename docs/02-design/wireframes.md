# Wireframes & UI Concepts

Low-fidelity layouts with the reasoning attached. Interactive high-fidelity concept:
[ui-concept.html](ui-concept.html).

Annotations marked **⚑** are decisions that will be argued about; the reasoning is given so the
argument happens once.

---

## 1. App shell

```
┌────────┬──────────────────────────────────────────────────────────────────┐
│        │  Northwind Design ▾        ● Updated 6:00am      ⌘K      ◐  ⚙   │
│  ◈ IQ  ├──────────────────────────────────────────────────────────────────┤
│        │                                                                  │
│  Ask   │                                                                  │
│  Home  │                          content                                 │
│ Forecast                                                                  │
│  Health│                                                                  │
│ What If│                                                                  │
│  Brief │                                                                  │
│  Watch │                                                                  │
│        │                                                                  │
│ ────── │                                                                  │
│  Data  │                                                                  │
│  Team  │                                                                  │
└────────┴──────────────────────────────────────────────────────────────────┘
```

**⚑ "Ask" is the first nav item, above "Home".** Nav order teaches users what a product is for. A
dashboard-first nav says "we show you charts"; an ask-first nav says "we answer questions." This
costs nothing and sets the mental model on every page load.

**⚑ The freshness indicator lives in the top bar on every screen**, not buried in settings. Stale
data presented as current is one of the severe failure modes in
[architecture §9](../03-engineering/architecture.md#9-failure-modes-we-design-against); making
freshness ambient is the cheapest defense.

---

## 2. Home — the answer bar

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Good morning, Dana.                                                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Cash is healthy — about 7 months of runway.                       │  │
│  │  One thing needs you: the Nov 15 payroll is projected $14,200      │  │
│  │  short. Three overdue invoices would more than cover it.           │  │
│  │                                    [ See the gap ]  [ Ask about it ]│  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │ Cash     │ │ Runway   │ │ Revenue  │ │ Margin   │                     │
│  │ $247,340 │ │ 7.2 mo   │ │ $186,200 │ │ 31.4%    │                     │
│  │ ▲ 3.1%   │ │ ▲ 0.4    │ │ ▲ 12%    │ │ ▼ 3.2pt  │                     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Cash forecast — 13 weeks                       [ table ] [ 90d ▾ ]│  │
│  │                                       ╱▔▔▔▔▔▔▔                     │  │
│  │  ──────────────────●╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌                   │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│┄┄┄┄┄┄◆ Nov 15 payroll ┄┄┄┄┄┄┄┄                 │  │
│  │                  today                                              │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

**⚑ The page opens with sentences, not charts.** This will feel wrong to anyone who has built a
financial dashboard. It's the central product bet: the user came to us because they can't interpret
charts, so leading with charts returns the burden we're supposed to be lifting
([PRD §2.1](../01-product/prd.md#21-the-wedge)).

**⚑ Four stat tiles, not twelve.** Everything else is one scroll down. A twelve-tile grid is a
confession that we don't know which four matter.

**⚑ Margin is down and colored as unfavorable; revenue is up and colored favorable — but the tile
for an expense metric going *down* would also be favorable.** Color follows `is_favorable`, never
direction ([design-system §2.6](design-system.md#26-the-direction-vs-sentiment-rule)).

---

## 3. Ask — the core surface

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Can I afford to hire a senior designer at $120k?                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ✓ Understanding  ✓ Pulling your numbers  ⣾ Analyzing…                   │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Yes — but wait until October.                                     │  │
│  │                                                                    │  │
│  │  [ $156,000 fully loaded ]  [ 5.8 mo runway after ]  [ break-even  │  │
│  │                                                        month 7 ]   │  │
│  │                                                                    │  │
│  │  A $120k salary costs about $156k all-in once you include employer │  │
│  │  taxes, benefits, and equipment. Hiring in October rather than now │  │
│  │  keeps you clear of the Nov 15 payroll gap, and your Q4 receivables│  │
│  │  land before the first full quarter of the new salary.             │  │
│  │                                                                    │  │
│  │  ▸ Assumptions (4)                     1.30× burden · 3-month ramp │  │
│  │  ◐ Medium confidence — 14 months of history; your revenue varies   │  │
│  │    more than typical for your size.                                │  │
│  │                                                                    │  │
│  │  → [ Model this as a scenario ]                                    │  │
│  │  ▸ Show the work                                                   │  │
│  │                                                                    │  │
│  │  ⌃ ⌄  Was this helpful?                                            │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Try next:  "What if they don't add revenue?"  ·  "Contractor instead?"  │
└──────────────────────────────────────────────────────────────────────────┘
```

**⚑ The headline is five words and answers the question.** Everything below is evidence. A user who
reads only the first line has been served correctly.

**⚑ Figures are chips, visually distinct from prose, and clickable.** This makes the grounding
*visible* — the numbers are objects with sources, not words in a sentence.

**⚑ Assumptions are collapsed but the two most important are shown inline** on the collapsed row.
Fully hiding them undermines the trust contract; fully expanding them buries the answer.

**⚑ Suggested follow-ups are the teaching mechanism.** Most users don't know what to ask second.
This is where they learn the product's range, and it's the highest-engagement element on the surface.

---

## 4. Forecast detail

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Cash forecast                    [ 13 weeks ▾ ]  [ base ▾ ]  [ table ]  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ $300k ┤                                          ╱▔▔▔▔▔▔▔▔▔  P90   │  │
│  │       │   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬●▬▬▬▬▬▬▬▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒          │  │
│  │ $200k ┤                       ╲╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  P50      │  │
│  │       │                        ╲▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒          │  │
│  │ $100k ┤ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄◆┄┄┄┄┄┄┄┄┄┄┄╲▁▁▁▁▁▁▁▁  P10        │  │
│  │       │  payroll floor        Nov 15                                │  │
│  │     0 ┼────────────────────────────────────────────────────         │  │
│  │        Aug        Sep        Oct        Nov        Dec              │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Risks                                                                   │
│  ◆ Nov 15 · Payroll $14,200 short          critical    [ Resolve ]       │
│  ◆ Sep 15 · Q3 estimated tax ~$18,400      watch       [ Plan ]          │
│                                                                          │
│  What's driving the projection            ▸ Committed  ▸ Receivables     │
│                                           ▸ Variable   ▸ New revenue     │
└──────────────────────────────────────────────────────────────────────────┘
```

**⚑ The payroll floor is a reference rule on the chart.** The user answers "will I make payroll?"
geometrically — they see the band dip below the line before reading any number. This is the single
best use of a chart in the whole product.

**⚑ Risk events are rows below the chart AND markers on it.** The chart shows *when*; the list shows
*what and what to do*. Neither alone is sufficient.

**⚑ The four streams are expandable, not shown by default.** Decomposition is available on demand;
showing four stacked areas by default makes the band unreadable.

---

## 5. Scenario — What If

```
┌────────────────────────────────────┬─────────────────────────────────────┐
│  Hire senior designer              │  Assumptions            [ reset ]   │
│                                    │                                     │
│         BASE          SCENARIO     │  Base salary      [ $120,000    ]   │
│  Runway  7.2 mo   →   5.8 mo  ▼    │  Burden multiple  [ 1.30×       ]ⓘ  │
│  Cash    $247k    →   $201k   ▼    │  Start date       [ Oct 1       ]   │
│  Profit  $58k/mo  →   $45k/mo ▼    │  Ramp to full     [ 3 months    ]ⓘ  │
│  Health  74       →   68      ▼    │  Revenue lift     [ $0          ]ⓘ  │
│                                    │  One-time setup   [ $4,000      ]   │
│  ┌──────────────────────────────┐  │                                     │
│  │  cash: base ▬▬  scenario ╌╌  │  │  ⓘ Revenue lift defaults to zero.   │
│  │  ▬▬▬▬▬▬╲                     │  │    Make the case for the cost       │
│  │        ╲╌╌╌╌╌╲___            │  │    first; add upside only if you    │
│  └──────────────────────────────┘  │    can name where it comes from.    │
│                                    │                                     │
│  Break-even: month 7               │  [ Save ]  [ Compare ]  [ Report ]  │
│  Largest risk: if the Vertex       │                                     │
│  account doesn't renew, runway     │                                     │
│  drops to 3.1 months.              │                                     │
└────────────────────────────────────┴─────────────────────────────────────┘
```

**⚑ Revenue lift defaults to $0, with the reasoning shown inline.** This is the most opinionated
default in the product. A scenario tool that defaults to optimistic assumptions helps people make bad
decisions with confidence. Forcing the user to name where the upside comes from is what a good CFO
does in the room.

**⚑ "Largest risk" is always populated.** A scenario result without a stated risk is a sales pitch,
not analysis.

---

## 6. Alert

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ┃ ⚠ CRITICAL · 19 days out                                              │
│ ┃                                                                        │
│ ┃  Nov 15 payroll is projected $14,200 short.                            │
│ ┃                                                                        │
│ ┃  Payroll runs $68,400. You're projected to have $54,200 that morning.  │
│ ┃  Three invoices totaling $38,100 are past due — historically these     │
│ ┃  customers pay 22 days late, which lands them after the 15th.          │
│ ┃                                                                        │
│ ┃  What you can do                                                       │
│ ┃  ┌──────────────────────────────────────────────────────────────────┐  │
│ ┃  │ Collect 3 overdue invoices        +$38,100   [ Draft emails ]    │  │
│ ┃  │ Defer 2 bills past the 15th        +$9,400   [ Review ]          │  │
│ ┃  │ Draw on your credit line          +$25,000   [ Model cost ]      │  │
│ ┃  └──────────────────────────────────────────────────────────────────┘  │
│ ┃                                                                        │
│ ┃  [ Model a combination ]        Not useful? ⌄                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**⚑ Left border rule, not a filled red card.** A full-bleed red panel triggers panic. The user has
19 days and three good options; the design should convey "handle this," not "emergency."

**⚑ Every action carries its estimated impact.** "Collect overdue invoices" is advice; "+$38,100" is
a plan.

**⚑ "Not useful" is present on a critical alert.** It feels risky to offer, and it's essential — it's
the feedback that keeps the false-positive budget honest
([PRD §5.4](../01-product/prd.md#54-smart-alerts)).

---

## 7. Firm console

```
┌──────────────────────────────────────────────────────────────────────────┐
│  47 clients · 4 need attention this week          [ all ▾ ] [ Reports ]  │
│                                                                          │
│  ⚠ NEEDS ATTENTION                                                       │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Northwind Design    58 ▼12   3.1 mo   ⚠ 2 critical    ● fresh      │  │
│  │ Harbor Contracting  61 ▼ 4   5.0 mo   ⚠ 1 critical    ● fresh      │  │
│  │ Cedar Studio        44 ▼ 8   1.8 mo   ⚠ 3 critical    ⚠ 4d stale   │  │
│  │ Pike & Co           70 ▼ 2   8.2 mo   ⚠ 1 high        ● fresh      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ✓ HEALTHY (43)                                              ▸ expand    │
└──────────────────────────────────────────────────────────────────────────┘
```

**⚑ Sorted by attention needed, never alphabetically.** The firm partner's job-to-be-done is "where
do my hours go this week." An alphabetical list makes them do that triage themselves, which is the
work we're selling.

**⚑ Healthy clients collapse to a count.** 43 rows of "everything is fine" is noise that hides the 4
rows that matter.

**⚑ Data staleness is a column.** An accountant advising on stale numbers is a professional liability
issue, so it gets equal billing with the financial metrics.

---

## 8. Onboarding — the connect moment

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         ●───●───○───○                                    │
│                                                                          │
│                Connect your accounting software                          │
│                                                                          │
│      This is where your revenue, expenses, and invoices live.            │
│      It's what lets me answer questions instead of guessing.             │
│                                                                          │
│      ┌────────────────────┐   ┌────────────────────┐                    │
│      │   QuickBooks       │   │      Xero          │                    │
│      └────────────────────┘   └────────────────────┘                    │
│                                                                          │
│      ┌────────────────────────────────────────────────────────────┐     │
│      │  🔒 Read-only. I can never move money or change your books.│     │
│      │     Encrypted in transit and at rest · Disconnect anytime  │     │
│      │     SOC 2 Type II audit in progress (report: Q2 2027)      │     │
│      └────────────────────────────────────────────────────────────┘     │
│                                                                          │
│              I'd rather look around first →                             │
└──────────────────────────────────────────────────────────────────────────┘
```

**⚑ The trust panel is the most important copy in the product.** This screen is where the funnel
dies ([onboarding §4](../01-product/onboarding.md#4-activation)). "Read-only, I can never move money"
addresses the actual fear in eight words.

**⚑ SOC 2 status is stated honestly, including the date.** Claiming a certification we don't hold is
fraud, and this buyer checks. "In progress, report Q2 2027" is more credible than a vague badge.

**⚑ "I'd rather look around first" is a real, prominent exit** into demo mode on sample data, not a
dead end. A meaningful share of users will not connect on first visit, and the alternative to this
link is losing them.

---

## 9. Responsive

Below 1024px: nav collapses to icons, stat tiles go 2×2, charts stack full-width.

Below 640px: nav becomes a bottom bar (Ask · Home · Forecast · Brief), tables become card lists —
**never horizontal scroll on a financial table** — and the answer block stays full-fidelity, because
reading an answer is the one thing people genuinely do on a phone.

**⚑ The forecast chart stays interactive on mobile** rather than degrading to a static image. Tap
replaces hover for the crosshair. This is the chart that answers the question people check their
phone for.
