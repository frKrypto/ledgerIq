# Customer Onboarding

**Onboarding is the hardest unsolved problem in this product**, harder than the AI. Every other
surface can be iterated after launch. Onboarding determines whether anyone ever sees those surfaces.

---

## 1. Why it's hard here specifically

Most SaaS onboarding asks a user to configure something. Ours asks them to **connect the most
sensitive data they own, to a company they heard about yesterday, before we've demonstrated any
value.** That is a large ask at the exact moment we have the least trust.

Compounding it, there are three delays we cannot design away:

1. **Historical backfill takes minutes to hours.** Two years of QuickBooks data behind a rate-limited
   API is not instant.
2. **Some insights need data depth.** Seasonality needs 24 months. Payment-behavior modeling needs
   observed payment history.
3. **Books may be bad.** If categorization is a mess, our first outputs are wrong, and a wrong first
   impression is unrecoverable.

So the design problem is: **earn enough trust to get the connection, then deliver something true and
surprising before the user's attention expires** — while data is still loading.

---

## 2. Target path

Signup → first true insight in **under 10 minutes of user time**, with backfill continuing behind it.

```
  0:00  Landing → "What's your biggest money question right now?"
  0:30  Question captured. Sign up (email/Google/Microsoft).
  1:30  Business profile: 4 questions, no more.
  2:30  Connect accounting (QuickBooks/Xero) ── the critical moment
  4:00  Connect bank (Plaid)
  5:00  [ Sync starts. Progressive reveal begins. ]
  5:30  FIRST TRUE FACT from partial data
  7:00  Chart-of-accounts confirmation (5 items, not 400)
  9:00  FIRST TRUE INSIGHT — their original question, answered
 10:00  Alerts configured, weekly brief scheduled → activated
```

---

## 3. Step-by-step, with the reasoning

### Step 0 — Ask the question first (0:00)

The landing page's primary input is not "Sign up." It's:

> **What's the money question you'd ask a CFO right now?**

with real examples as placeholders. This does four things at once:

- Converts better than a signup form, because answering a question costs nothing
- **Captures intent** — we now know what this user actually wants, which becomes the payoff at 9:00
- Sets the product's mental model in one interaction: you ask, we answer
- Gives us the single most valuable dataset for prioritization — what real prospects actually want to
  know, in their own words, at scale

If they bounce before connecting, we still have the question and an email, which makes the follow-up
sequence specific rather than generic.

### Step 1 — Signup (0:30)

Email, Google, or Microsoft. **No credit card.** Asking for payment before we've shown a number is
optimizing the wrong step. MFA enrollment is prompted here but can be deferred once; it becomes
mandatory before the first financial view.

### Step 2 — Business profile (1:30)

Exactly four questions, because each additional one costs completion:

1. What does your business do? *(free text → NAICS classification, drives benchmarking)*
2. Roughly how many people? *(band)*
3. Roughly what's annual revenue? *(band — sets expectations and the benchmarking cohort)*
4. What accounting software? *(routes the next step)*

Everything else we infer from the data. Asking for a fiscal year start or an accounting basis here
would be correct and would also lose people; we detect both from QuickBooks and confirm later.

### Step 3 — Connect accounting (2:30) — **the critical moment**

This is where funnels die. The screen must do trust-building work, and it should be explicit rather
than decorative:

- **"Read-only. We can never move money or change your books."** Stated plainly, at the moment of
  hesitation, because it's the actual fear.
- Named security posture — encryption, SOC 2 status stated honestly (in progress vs. complete;
  claiming a certification we don't hold is both fraud and, in this segment, checkable)
- What we'll do with it, in one sentence
- The disconnect-anytime guarantee, with what happens to their data

**Handling the "not yet" user.** Some fraction will not connect on first visit no matter what. Rather
than losing them, offer a **demo mode on a realistic sample business** where they can ask their own
question and see a real answer. This converts meaningfully better than a nurture email, because they
experience the product rather than reading about it. Their captured question from Step 0 gets asked
against the sample data.

### Step 4 — Connect bank (4:00)

Immediately after, while momentum is high. Framed on value: *"Cash forecasting needs your actual
balances — this is what lets us tell you about payroll before it's a problem."*

Multiple accounts supported; we ask which are operating accounts, since that drives runway and
payroll coverage. Skippable — with a clear, non-nagging statement of what stays unavailable.

### Step 5 — Progressive reveal during sync (5:00–9:00)

**The most important design decision in onboarding: never show a progress bar with nothing behind
it.** Reveal true facts as they become computable.

| Elapsed | Data available | What we show |
|---|---|---|
| ~30s | Balances, recent transactions | "You have $247,000 across 3 accounts." |
| ~90s | 3 months of P&L | "Revenue is up 12% over the last 3 months." |
| ~3 min | 12 months | "Your strongest month is usually November." |
| ~5 min | Full history + AR | "3 customers are 30+ days late — $38,100 outstanding." |
| ~7 min | Forecast computed | The answer to *their* question from Step 0 |

Each is true, specific, and about *their* business. By the time sync completes, they've seen five
things they didn't know, and the wait has been the experience rather than an obstacle to it.

### Step 6 — Chart of accounts confirmation (7:00)

We map their accounts to our canonical categories. Most map unambiguously. **We show only the
ambiguous ones — five, not four hundred:**

> *"You have an account called 'Contractor Costs — Misc.' Is this cost of goods (direct project
> work) or overhead?"*

Two things this accomplishes beyond accuracy: it demonstrates that we're actually reading their
books, and it establishes that we ask rather than assume — which is the relationship we want for
every later assumption the product makes.

### Step 7 — The payoff (9:00)

Their original question, answered with their real data, in the full answer format: headline, figures,
why, assumptions, confidence, recommended action.

This moment is the entire funnel. Everything before it is setup. It should be unmistakably better
than anything they could have gotten from their existing tools, and it should feel like a person
answered it.

### Step 8 — Set the loop (10:00)

Three defaults, pre-selected, one screen:

- **Weekly brief**, Monday 7am — the habit loop
- **Critical alerts** on — payroll risk, cash shortfall, tax obligations
- Invite a teammate or accountant *(optional, but a strong retention correlate)*

---

## 4. Activation

**Definition: a user who has connected at least one accounting or banking source AND received at
least one true insight about their business.** Target: 55% at 6 months, 70% at 18.

Not "signed up." Not "connected." Insight delivered — because that's the first moment the product has
done its job.

**Instrumented per step**, so we can see where the funnel breaks rather than guessing:

| Step | Expected drop | If worse, the problem is |
|---|---|---|
| Landing → question asked | 60–70% engage | Question framing or examples |
| Question → signup | 40% | Value proposition |
| Signup → profile complete | 85% | Too many questions |
| **Profile → accounting connected** | **55%** | **Trust — the highest-leverage step in the product** |
| Accounting → bank connected | 75% | Framing of why it's needed |
| Connected → first insight | 90% | Sync reliability, or data quality |

The accounting connection step deserves disproportionate design and experimentation investment. A
10-point improvement there is worth more than any feature on the roadmap.

---

## 5. The bad-books problem

A real and common case: the user connects, and their books are a mess — everything in "Uncategorized,"
personal expenses mixed in, unreconciled accounts.

We have three options and only one is right.

| Option | Verdict |
|---|---|
| Produce insights anyway | **No.** Wrong numbers on day one destroy trust permanently. |
| Refuse until books are fixed | **No.** We lose a user with a real problem we could partly help with. |
| **Be honest, deliver what's reliable, offer to help** | **Yes.** |

The right experience:

> *"Your bank data is clean, so I can tell you about cash and runway with confidence. About 40% of
> your expenses are uncategorized in QuickBooks, so profit-by-category won't be reliable yet. Want me
> to suggest categories for the 200 largest? Takes about 5 minutes and unlocks margin analysis."*

This turns a weakness into a demonstration of judgment. Being honest about our own limits is a
stronger trust signal than a confident dashboard, and it is a genuine differentiator from competitors
who will happily chart garbage.

The categorization assist is also a great early feature: high value, bounded scope, and it makes our
own outputs better — an alignment worth having.

---

## 6. The disqualification path

Some signups should not become customers, and saying so early is better for everyone:

- **No accounting software and no bank connection** — we have nothing to compute on
- **Pre-revenue with no transactions** — nothing to analyze; offer a waitlist and a "come back when
  you have revenue" note
- **Fewer than 3 months of any data** — we can connect and start accumulating, but we set the
  expectation explicitly that insight quality improves over the next 90 days

Handling this gracefully costs little and prevents a churn cohort that would otherwise poison our
retention numbers and our support queue. It also builds goodwill — a company that tells you it isn't
right for you yet is one you come back to.

---

## 7. First 30 days

Onboarding doesn't end at activation. The first month establishes the habit.

| When | Touch | Purpose |
|---|---|---|
| Day 1 | First insight (in product) | Value |
| Day 2 | Email: "3 things I noticed about your business" | Depth — proof there's more than the first answer |
| Day 4 | First proactive alert (if any condition is real) | Demonstrate the watching-your-back value |
| Day 7 | **First weekly brief** | Establish the habit loop |
| Day 10 | Prompt: try a scenario ("what if you hired someone?") | Introduce the highest-value feature |
| Day 14 | Health score with first trend | Show progress over time |
| Day 21 | Prompt: invite accountant/partner | Multi-user is a strong retention correlate |
| Day 28 | Month-in-review report | Demonstrate the recurring artifact they'd pay for |

**The day-7 weekly brief is the single most important touch.** If it's opened and clicked, retention
odds change materially. It gets the most copywriting attention of anything we send.

---

## 8. Trial and conversion

**14-day free trial, full features, no credit card.**

Reasoning: requiring a card raises trial-to-paid conversion rate while lowering total conversions,
and — more importantly here — it adds friction at the *worst* possible moment, before we've shown
value. In a product whose entire challenge is earning trust at the connection step, adding a payment
gate before that step is fighting ourselves.

Conversion happens on demonstrated value, so the trial is sequenced to guarantee two weekly briefs
and at least one real alert land before day 14.

**At trial end**, the paywall is specific rather than generic: *"In 14 days I found $4,200/mo in
duplicate subscriptions, flagged a payroll risk 3 weeks out, and answered 11 questions. Keep going
for $199/mo."* Concrete value recall beats a feature list — and we have the data to make it true for
each account.
