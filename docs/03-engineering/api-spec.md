# API Specification

Machine-readable contract: [`schema/openapi.yaml`](schema/openapi.yaml).

Two surfaces, deliberately different:

- **Internal (tRPC)** — consumed only by our Next.js app. Type-safe, no codegen, free to change with
  the client. Not documented here; it follows the metric catalog and is generated from it.
- **Public (REST + OpenAPI)** — consumed by accounting firms, partner tools, and eventually an app
  ecosystem. A deliberate, versioned, slow-moving contract.

This document specifies the public API. The distinction matters: projecting internal types outward
is how you end up unable to refactor.

---

## 1. Principles

1. **The API returns the same grounded objects the UI renders.** A figure returned by the API carries
   its provenance, confidence, and period, exactly as in the product. An API that returns bare
   numbers would be a different, worse product.
2. **Versioned by URL path** (`/v1/`). Breaking changes require a new version; additive changes don't.
3. **Idempotency required on all writes** via `Idempotency-Key`. Financial systems get retried.
4. **Cursor pagination only.** Offset pagination over a table that's being written to returns
   duplicates and gaps. Not acceptable here.
5. **Errors are typed and actionable**, with a stable `code` and a machine-readable `details`.
6. **Every response states data freshness.** A caller integrating our numbers into their own tooling
   must know how stale they are.

---

## 2. Authentication & authorization

| Method | Use | Notes |
|---|---|---|
| API key (`Authorization: Bearer lq_live_…`) | Server-to-server | Scoped to one org; hashed at rest (argon2); prefix displayable |
| OAuth 2.0 authorization code + PKCE | Third-party apps acting for a user | Required for anything in the app ecosystem |
| Firm-scoped key | Accounting firms across clients | Must set `X-LedgerIQ-Org` per request; validated against `firm_clients` |

**Scopes** are read-oriented by design; the public API exposes no money movement and no connector
credential access.

```
read:metrics    read:transactions   read:forecasts   read:reports
read:alerts     read:scenarios      write:scenarios  write:annotations
```

**Firm access is per-request, not ambient.** A firm key with 60 clients must name exactly one org per
request via `X-LedgerIQ-Org`. There is no "fetch across all my clients" endpoint that returns raw
financial records — cross-client endpoints return only rollup summaries. This mirrors the database
posture in [database-schema §4](database-schema.md#4-row-level-security): breadth of access is never
achieved by widening a tenant scope.

---

## 3. Conventions

**Base URL:** `https://api.ledgeriq.com/v1`

**Money** is always an object, never a bare number. This is verbose and it is correct — a bare
number invites currency and unit-scaling bugs at the integration boundary:

```json
{ "amount": "14200.0000", "currency": "USD", "minor_units": 1420000 }
```

Amounts are strings in decimal form to survive JSON float parsing, with `minor_units` as an integer
convenience.

**Every computed figure** returns as a `Figure`:

```json
{
  "key": "runway_months",
  "value": "7.2",
  "unit": "months",
  "period": { "start": "2026-07-01", "end": "2026-07-31", "grain": "month" },
  "confidence": "high",
  "provenance": {
    "metric_key": "runway_months",
    "engine_version": "2026.07.1",
    "computed_at": "2026-07-27T06:00:00Z",
    "drill_down_url": "/v1/metrics/runway_months/sources?period=2026-07",
    "data_freshness": {
      "accounting": "2026-07-27T04:00:00Z",
      "banking":    "2026-07-27T05:45:00Z"
    }
  }
}
```

**Pagination**

```
GET /v1/transactions?limit=100&cursor=eyJvIjoiMjAyNi0wNy0yNyJ9
→ { "data": [...], "next_cursor": "...", "has_more": true }
```

**Rate limits** — 100 req/min standard, 1000 req/min firm tier; AI endpoints 20 req/min. Returned in
`X-RateLimit-*` headers. `429` includes `Retry-After`.

**Errors**

```json
{
  "error": {
    "code": "insufficient_data",
    "message": "Customer profitability requires job-costing data, which isn't present in this org's books.",
    "details": { "required_sources": ["accounting"], "missing_fields": ["invoice_lines.project_ref"] },
    "request_id": "req_01J8..."
  }
}
```

`insufficient_data` is a first-class error, not an edge case. Returning zeros or nulls when we cannot
honestly compute something is the failure mode we're designing against.

---

## 4. Endpoints

### 4.1 Metrics

```
GET  /v1/metrics                       List available metrics for this org, with availability
GET  /v1/metrics/{key}                 Single metric for a period
GET  /v1/metrics/{key}/series          Time series
GET  /v1/metrics/{key}/sources         Drill-down: source records behind a figure
GET  /v1/metrics/{key}/decomposition   What drove the change vs. a comparison period
POST /v1/metrics/batch                 Up to 50 metrics in one round trip (dashboard load)
```

`GET /v1/metrics` returns availability per metric — `available`, `insufficient_data`, or
`requires_connection` with the specific source needed. Clients should render from this rather than
hardcoding a metric list, because which metrics are honest varies by business model
([PRD §5.5](../01-product/prd.md#55-financial-dashboard)).

`/decomposition` is the endpoint behind "why did profit decrease?" — it returns ranked contributing
factors with their individual deltas, which is the raw material for causal narration.

### 4.2 Cash & forecasting

```
GET  /v1/cash/position                 Current cash across included accounts
GET  /v1/forecasts/cash                Latest 13-week projection with P10/P50/P90
GET  /v1/forecasts/cash/{id}           A specific historical forecast (reproducible)
GET  /v1/forecasts/cash/accuracy       Our published accuracy for this org
GET  /v1/forecasts/risks               Named risk events (payroll shortfall, tax, large expense)
POST /v1/forecasts/cash/recompute      Force a recompute (rate limited)
```

`/accuracy` exists because we publish our own error rate to users
([PRD §5.2](../01-product/prd.md#52-cash-flow-forecasting--the-wedge)). Exposing it in the API keeps
us honest — it's much harder to quietly stop measuring something that partners can query.

### 4.3 AI CFO

```
POST /v1/ask                           Ask a question (SSE streaming or blocking)
GET  /v1/ask/{trace_id}                Retrieve a completed answer with its full trace
POST /v1/ask/{trace_id}/feedback       Thumbs up/down + note
GET  /v1/conversations                 List
GET  /v1/conversations/{id}/messages   History
```

`POST /v1/ask` request:

```json
{
  "question": "Can I afford to hire a senior engineer at $150k?",
  "conversation_id": "conv_...",
  "stream": true,
  "include_trace": true,
  "literacy": "standard"
}
```

Response follows the answer contract from [PRD §5.1](../01-product/prd.md#51-ai-cfo-chat):

```json
{
  "trace_id": "trc_01J8...",
  "headline": "Yes, but not until October — hiring now would put the Nov 15 payroll at risk.",
  "figures": [ { "key": "fully_loaded_cost", "value": "195000.0000", "...": "..." } ],
  "why": "A $150k salary carries roughly $45k in employer taxes, benefits, and equipment...",
  "assumptions": [
    { "key": "burden_multiplier", "value": "1.30", "editable": true,
      "description": "Fully-loaded cost multiplier applied to base salary" },
    { "key": "ar_timing_from_history", "description": "Receivables land per each customer's observed payment behavior" }
  ],
  "confidence": { "level": "medium", "reason": "14 months of history; revenue variance is above typical for your industry" },
  "recommended_action": { "text": "Revisit in October once the Q3 receivables land.", "type": "defer" },
  "data_freshness": { "accounting": "2026-07-27T04:00:00Z", "banking": "2026-07-27T05:45:00Z" },
  "trace_url": "/v1/ask/trc_01J8..."
}
```

**Note what is absent: free-form prose containing numbers.** `why` is narrative, but every figure
that appears in it is a resolved slot, and `figures` is the authoritative list. A client that wants
to re-render the answer in its own UI has the numbers structurally, not by parsing English.

Streaming (`text/event-stream`) emits `stage` events (`classifying`, `planning`, `computing`,
`writing`) so a client can show real progress rather than a spinner — perceived latency is a product
concern, and the stages are genuinely informative here.

### 4.4 Scenarios

```
GET  /v1/scenarios                     List saved
POST /v1/scenarios                     Create and run
GET  /v1/scenarios/{id}                Retrieve with results
PATCH /v1/scenarios/{id}               Edit assumptions → recompute
POST /v1/scenarios/compare             Compare up to 4 scenarios against base
DELETE /v1/scenarios/{id}
```

```json
POST /v1/scenarios
{
  "name": "Hire senior engineer",
  "kind": "hire",
  "inputs": { "annual_base": "150000.0000", "start_date": "2026-10-01", "department": "engineering" },
  "assumption_overrides": { "burden_multiplier": "1.35", "ramp_months": 3 }
}
```

Returns base-vs-scenario deltas on cash, runway, profit, and health score, plus the break-even month
and the scenario's largest risk. Every assumption is returned as an editable object — the interaction
we want is the user arguing with the model's assumptions, not accepting them.

### 4.5 Transactions, entities, alerts, reports

```
GET  /v1/transactions                  Filter by period, category, customer, vendor, amount
GET  /v1/transactions/{id}             Single, with full lineage to raw payload
PATCH /v1/transactions/{id}            Category override (locks against re-categorization)
GET  /v1/customers                     With profitability and payment behavior
GET  /v1/customers/{id}/profitability
GET  /v1/vendors                       With subscription/recurring detection
GET  /v1/invoices                      AR, with expected_payment_date and probability
GET  /v1/alerts                        Filter by state, severity
POST /v1/alerts/{id}/acknowledge
POST /v1/alerts/{id}/feedback          Tunes per-org thresholds
GET  /v1/reports                       List generated
POST /v1/reports                       Generate on demand
GET  /v1/reports/{id}                  JSON content
GET  /v1/reports/{id}/pdf              Rendered PDF
```

`GET /v1/transactions` defaults to canonical, non-transfer, non-voided records — the
`v_transactions_analytical` view. Retrieving mirrors and transfers requires explicit
`?include=mirrors,transfers`, because the default should be the one that produces correct sums.

### 4.6 Connections

```
GET  /v1/connections                   Status and freshness per connection
POST /v1/connections/link_token        Short-lived token to start a connect flow
POST /v1/connections/{id}/sync         Trigger sync (rate limited)
DELETE /v1/connections/{id}            Disconnect
```

Credentials are never readable through the API, under any scope. `POST /link_token` returns a
short-lived token for the provider's own client-side flow; raw credentials never transit our API.

### 4.7 Firm endpoints

```
GET  /v1/firm/clients                  Orgs this firm can access
GET  /v1/firm/dashboard                Cross-client risk ranking (rollups only)
GET  /v1/firm/alerts                   Aggregated across clients, ranked by severity
```

`/firm/dashboard` returns summary objects — health score, runway band, open critical alerts — not
transaction-level data. Detail requires a scoped request naming one org.

---

## 5. Webhooks

Outbound, for partners who want push rather than poll.

```
alert.triggered            forecast.risk_detected      health_score.changed
connection.status_changed  report.generated            sync.failed
```

Payloads are signed (`X-LedgerIQ-Signature`, HMAC-SHA256 over the raw body with a per-endpoint
secret, timestamped to prevent replay). Delivery retries with exponential backoff for 24 hours, then
the endpoint is marked failing and surfaced in the UI.

Webhook payloads carry the event and identifiers, **not** the full financial detail. The consumer
fetches detail through the authenticated API. This keeps financial data out of logs, proxies, and
whatever the partner's endpoint does with request bodies.

---

## 6. Versioning and deprecation

- `/v1/` is the contract. Additive changes (new fields, new endpoints, new enum values) ship without
  a version bump — clients must tolerate unknown fields.
- Breaking changes ship as `/v2/` with both live for **12 months minimum**.
- Deprecations announce via `Sunset` and `Deprecation` headers, the changelog, and direct email to
  active integrators.
- `engine_version` in provenance is separate from API version. A metric definition changing is not an
  API break, but it *is* visible — which is the point.
