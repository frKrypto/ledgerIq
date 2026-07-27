# Integration Strategy

The founding brief lists 17 integrations. **We should build 3 for launch.** This document argues
why, and sequences the rest against actual product value.

---

## 1. The case against breadth

Integration count is the most seductive vanity metric in B2B software. It looks like progress, it
fills a comparison table, and it is almost always the wrong place to spend a seed-stage engineering
budget.

The real cost of a connector is not the OAuth flow. It's:

| Cost | Typical | Why it's larger than expected |
|---|---|---|
| Initial build | 1–2 weeks | The easy part |
| Normalization into our canonical model | 2–4 weeks | Every provider models money differently; this is where the time goes |
| Edge cases and reconciliation | 1–2 weeks | Refunds, partial payments, multi-currency, voided records, restatements |
| **Ongoing maintenance** | ~0.5 eng-week/month, forever | APIs change, tokens expire, providers deprecate endpoints |
| Support burden | Continuous | Every connector is a new category of "my data looks wrong" ticket |

Call it **4–8 engineer-weeks up front plus a permanent maintenance tax**. Seventeen connectors is
roughly two engineer-years before we've built any product, and a maintenance load that would consume
an entire engineer indefinitely.

Worse, each marginal connector has *decreasing* value. The second bank connection adds a little. A
Salesforce connection adds almost nothing to a cash forecast.

---

## 2. What actually drives answer quality

Rank integrations by the questions they unlock, not by logo recognition.

| Data we need | Unlocks | Source |
|---|---|---|
| Categorized P&L, AR, AP, chart of accounts | Profitability, margin decomposition, AR aging, customer profit, tax estimation | **Accounting (QBO/Xero)** |
| Actual cash balances and cleared transactions | Runway, current position, forecast anchor, payroll coverage | **Banking (Plaid)** |
| Revenue detail, subscriptions, refunds, fees | MRR/ARR, churn, revenue recognition, net-vs-gross reconciliation | **Payments (Stripe)** |
| Payroll timing and burdened cost | Payroll risk (the wedge), hiring scenarios, true labor cost | Payroll (Gusto) |
| Order-level revenue and COGS | E-commerce margin, inventory-driven cash | Commerce (Shopify) |
| Pipeline | Forward revenue in the forecast | CRM (HubSpot) |

**QuickBooks + Plaid + Stripe answers the large majority of the questions in the founding brief.**
That is the launch set.

The notable near-miss is payroll. Payroll timing is central to the wedge — but the accounting
connection already gives us historical payroll as categorized expense, and its cadence is highly
regular. We can project payroll accurately from that pattern without Gusto. Gusto improves precision
(exact upcoming run amounts, employee-level detail) rather than enabling the capability, which makes
it the strongest V1.1 candidate rather than a launch blocker.

---

## 3. Launch set

### QuickBooks Online — *the anchor*

The most important integration. QBO holds the accrual truth: categorized revenue and expense, AR,
AP, chart of accounts, customers, vendors.

- OAuth 2.0, tokens refresh every 100 days; refresh failures are a top support category
- Change Data Capture endpoint for efficient incremental sync
- Rate limits are real (throttled per realm) — the backfill of several years of history must be
  paced and resumable
- **The hard part is the chart of accounts.** Every business has a different one, most are partly
  wrong, and mapping arbitrary account names to our canonical statement categories is genuinely
  difficult. This is where an LLM is legitimately useful: a one-time, human-confirmed mapping pass
  during onboarding, cached thereafter. Not a per-transaction LLM call.

### Plaid — *cash truth*

Bank and credit card balances plus transactions. Anchors every forecast.

- Well-documented; the integration itself is not the challenge
- **Connections break constantly.** Bank MFA changes, credential rotations, institution migrations.
  Re-auth must be a two-click flow triggered by an escalating notification, not a support ticket.
- Transaction descriptions are famously poor (`SQ *MERCHANT 1234`), so merchant normalization is a
  real sub-project
- Cost is per-item per-month and becomes a meaningful COGS line at scale — modeled in
  [pricing §7](../04-business/pricing.md#7-cogs-and-gross-margin)

### Stripe — *revenue detail*

For any business taking card payments, Stripe holds detail the GL flattens.

- Excellent API; the cleanest of the three
- **The value is reconciliation.** Stripe payouts arrive in the bank net of fees, while QBO may
  record them gross, net, or inconsistently. Reconciling the three views is exactly the kind of
  synthesis no single tool does — and it's a genuine "how did you know that?" moment in the product.
- Subscription objects give real MRR/ARR and churn rather than estimates

---

## 4. Sequencing after launch

Each tier is gated on evidence, not on a calendar.

**V1.1 — driven by segment demand**
- **Gusto** — sharpens the wedge; also unlocks true fully-loaded hiring scenarios
- **Xero** — the QBO alternative; opens the non-US-centric and design-conscious SMB segment. Build
  it when inbound demand justifies it, which for a US-first launch is usually month 6–9.

**V1.2 — driven by segment expansion**
- **Shopify / Square / PayPal** — only if we commit to e-commerce and retail as a target segment.
  This is a segment decision before it's an engineering one.
- **Ramp / Brex / Mercury** — increasingly common in startup-adjacent businesses; good spend detail

**V2 — driven by upmarket motion**
- **HubSpot / Salesforce** — pipeline improves forward revenue forecasting, which matters more for
  larger customers
- **Amazon Seller** — high complexity, narrow segment, notoriously painful settlement reporting
- **Google Workspace / Microsoft 365** — worth being precise: these are not financial data sources.
  Their value is *distribution and delivery* — SSO, calendar context for cash-timing, and delivering
  reports into Drive or SharePoint. Treat them as platform integrations, not data connectors, and
  don't let them onto the data roadmap where they'll be mis-prioritized.

**Deliberately deprioritized:** direct bank APIs (Plaid abstracts them; going direct is a Phase 4
cost-reduction play, not a capability), and any integration whose primary justification is a logo on
the website.

---

## 5. The universal fallback: CSV and PDF import

Every business we cannot connect can still be served. A CSV/PDF statement importer with intelligent
column mapping covers the long tail at a fraction of connector cost, and it is the honest answer to
"do you integrate with [obscure regional bank]?"

This is genuinely good LLM use: mapping an arbitrary spreadsheet's columns to our canonical model is
a well-bounded, one-time, human-confirmable task where a wrong guess is caught immediately by the
user. Build this in V1 — it costs about one connector and covers dozens.

---

## 6. Architecture that keeps this cheap

The adapter interface ([architecture §4](architecture.md#4-service-boundaries)) is what makes the
"three now, more later" strategy safe:

```ts
interface ConnectorAdapter {
  readonly source: SourceSystem;
  readonly kind: SourceType;
  authorize(ctx: OrgContext, params: AuthParams): Promise<Connection>;
  fullSync(conn: Connection, opts: { since?: Date }): AsyncIterable<RawBatch>;
  incrementalSync(conn: Connection, cursor: string): AsyncIterable<RawBatch>;
  handleWebhook(payload: unknown, sig: string): Promise<SyncTrigger>;
  healthCheck(conn: Connection): Promise<ConnectionHealth>;
  normalize(batch: RawBatch): CanonicalRecord[];
}
```

Everything downstream of `normalize` is source-agnostic. Adding a connector touches exactly one
directory and adds zero conditionals to the metric engine. If that stops being true, it's a design
regression worth stopping to fix — source-specific branching leaking into business logic is how
integration strategies become unmaintainable.

Two supporting decisions:

- **Raw payloads are archived immutably** ([schema](schema/schema.sql), `raw_payloads`). When a
  normalization bug is found, we replay from the archive rather than re-fetching from a provider
  that may no longer return the same data.
- **Reconciliation is per-connector.** Each adapter reports source-side totals that we compare
  against our normalized totals nightly. Divergence alerts before a user notices. This catches
  silent breakage that health checks miss — the API returning 200 with subtly incomplete data is the
  failure mode that actually hurts.

---

## 7. What to tell customers and investors

We will be asked "do you integrate with X?" constantly. The honest, strong answer:

> "We connect to QuickBooks, your bank, and Stripe — which is where the answers actually come from.
> We deliberately went deep on making those three reconcile correctly rather than shallow on twenty.
> If you need something else, our importer handles it today and we add connectors based on what
> customers actually ask for."

This is more credible than a wall of logos, and it's true. The counter-position writes itself: a
competitor with 40 integrations and no reconciliation between them produces confident wrong numbers,
which is worse than no numbers.
