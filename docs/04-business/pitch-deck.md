# Investor Pitch — Slide Outline

**14 slides + appendix.** Target: 12–15 minutes, leaving 30 for discussion. Narrative and objection
handling: [fundraising.md](fundraising.md).

Design follows [brand-identity.md](../02-design/brand-identity.md) — restrained, typographic, numbers-forward. No
stock photos, no gradient hero shapes, one idea per slide.

---

## 1 — Title

> ## LedgerIQ
> ### An AI CFO for small business
> Seed · $3.5M

**Say:** Nothing beyond the one-liner. Don't narrate the title slide.

---

## 2 — The problem, made concrete

> ## A $3M agency with 22 employees has four financial systems
> ### and no answer to "can I afford to hire?"

Visual: four logos (QuickBooks, Chase, Stripe, Gusto) → a question mark.

**Say:** Set up one specific business, not a market abstraction. QuickBooks shows what happened in a
vocabulary they were never taught. The bank shows a balance with no context. None of them answer the
question that actually matters. So they guess — which is why profitable businesses run out of cash.

---

## 3 — The gap is structural

> ## Financial complexity arrives a decade before you can afford a CFO

| | Cost | What you get |
|---|---|---|
| Bookkeeper | $500–1,500/mo | Clean books, no advice |
| Fractional CFO | $3–8K/mo | Advice, monthly, only above ~$2M revenue |
| Full-time CFO | $15–25K/mo | Everything, unaffordable |

**Say:** This isn't a tooling gap, it's an economic one. There's a long window where the decisions are
consequential and there's no analytical support at any price they can pay.

---

## 4 — Why now

> ## Three things became true in the last two years

1. Models can plan multi-step financial analysis and explain it in plain language
2. Inference is cheap enough for 90% gross margin at $249/mo
3. Accounting and banking APIs are mature enough to build on

**Say:** This product was not buildable in 2019 — and the demand side shifted too. Owners now expect
to type a question and get an answer, which removes the education barrier this category always had.

---

## 5 — The product *(demo, not slides)*

> ## Ask a question. Get a CFO's answer.

Live or recorded: type *"Can I afford to hire a senior designer at $120k?"* → the answer block.

**Say:** Walk through the answer contract out loud — headline, figures, why, assumptions, confidence,
recommendation. Then **click a number and show the source transactions.** That drill-down is the
moment the pitch lands; hold on it.

---

## 6 — The insight that makes it work

> ## The model never does arithmetic

```
Question → Planner → METRIC ENGINE (deterministic) → Narrator → Verifier
                     every number originates here
```

**Say:** This is the core engineering bet. Most entrants pipe transactions into a context window and
ask for analysis. It demos beautifully and it's unshippable — one wrong number and every other number
becomes suspect forever. Our model has no arithmetic authority; it writes slot references that the
renderer fills from computed values. A bare numeral in model output is a caught error, not a shipped
one.

---

## 7 — The wedge

> ## "You'll be $14,200 short for the Nov 15 payroll."
> ### Falsifiable. High-stakes. Every two weeks.

**Say:** Everyone in this category is building the chat box. Chat has poor standalone retention —
five questions in week one, none in week four. What creates dependency is a specific, checkable,
recurring claim about something they're afraid of. We lead with the payroll alert; chat is the depth
behind it.

---

## 8 — Market

> ## 1.1M US businesses, built bottom-up

- 2.5M employer businesses, 5–500 employees
- 1.8M with $500K–$50M revenue
- **1.1M on QuickBooks or Xero → $3.3B SAM**
- **Beachhead: 220K services businesses → $660M**

**Say:** Lead with the beachhead. Ten thousand businesses at $249/mo is $30M ARR and under 1% of SAM.

---

## 9 — Distribution

> ## Accountants are the channel, not a segment

| Direct SMB | Via a firm |
|---|---|
| $400–900 CAC | $40–120 CAC |
| Cold trust | Warm introduction |
| Books quality unknown | Books already clean |
| One at a time | 40–200 per relationship |

**Say:** SMB fintech dies of CAC, not of product. One firm partnership is worth a quarter of direct
sales effort — and the firm has already solved the trust problem for us. We make them more
profitable; we never disintermediate them.

---

## 10 — Moat

> ## Every forecast we've ever made is scored against what actually happened

```
More businesses → more forecast/actual pairs → better accuracy
       ↑                                              ↓
   More trust  ←──────────  measurably better product
```

**Say:** The integrations aren't the moat — those are commodity. The moat is the outcome dataset:
per-industry payment-behavior priors and residual corrections that only exist after years of
observation. A competitor starting in 2028 cannot buy it. We instrument it from the first forecast,
even though it produces no value for eighteen months.

---

## 11 — Business model

> ## $99 / $249 / $599 · ~90% gross margin

- Growth tier is the default at $249 — 6% of a fractional CFO
- Firm tier: $499 + $39/client
- COGS ~$22/mo on Growth, dominated by inference and Plaid
- Target: CAC payback <12 months, LTV:CAC >3:1

**Say:** One caught payroll shortfall pays for a year. The ROI conversation is unusually easy — and
we instrument for specific saves so the renewal conversation cites a real number.

---

## 12 — Traction

*(Populate with actuals.)*

> ## Design partners, and the metrics that matter

- N businesses connected · week-4 retention · forecast MAPE · case studies with specific saves

**Say:** The metric to watch at this stage is week-4 retention, not signups. And we measure our own
forecast accuracy from day one — which we intend to publish.

---

## 13 — Team

*(Populate.)*

**Say:** Why us, specifically — domain experience with the problem plus a track record building
reliable data systems. Reference the architecture as evidence we understand why the naive version
fails.

---

## 14 — The ask

> ## $3.5M seed · 24 months
> **To:** 500+ businesses · 15+ firm partnerships · SOC 2 Type II · $1.5M ARR · Series A ready

Use of funds: 55% engineering · 15% product/design · 18% GTM · 12% infra, compliance, legal

---

## Appendix

Have these ready; don't present them:

| Slide | Content |
|---|---|
| A1 | Competitive landscape and positioning map |
| A2 | Intuit risk — the full honest answer |
| A3 | Architecture detail |
| A4 | Security and compliance posture |
| A5 | Unit economics by tier and channel |
| A6 | Detailed financial model |
| A7 | Product roadmap, 18 months |
| A8 | Integration strategy — why 3, not 17 |
| A9 | Risk register |

---

## Delivery notes

- **Slide 5 (demo) and slide 6 (the architecture insight) carry the pitch.** If time gets cut,
  protect those two.
- **Bring up the Intuit risk yourself**, on slide 9 or 10. Volunteering it reads as confidence;
  being caught by it reads as naivety.
- **Never say "we're the only ones doing this."** It's false and it signals you haven't looked.
- **The drill-down click is the single most persuasive thing in the room.** Practice it until it's
  smooth on a real account.
- Numbers on every slide. This is a finance product pitched to finance people; vagueness is
  disqualifying.
