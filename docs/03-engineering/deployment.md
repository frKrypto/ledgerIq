# Deployment & Infrastructure

---

## 1. Environments

| Env | Purpose | Data | Access |
|---|---|---|---|
| `local` | Development | Synthetic fixtures + connector sandboxes | All engineers |
| `ci` | Automated testing | Ephemeral Postgres via Testcontainers | Automation only |
| `staging` | Pre-production verification | Synthetic, production-shaped | All engineers |
| `production` | Live | Customer data | JIT elevation only ([security §6](security.md#6-internal-access-controls)) |

**No production data in any non-production environment, ever.** The common shortcut — "sanitized"
production data in staging — is not sanitizable for financial records: transaction descriptions,
customer names, and amounts are jointly re-identifying even after obvious fields are scrubbed.

This raises the value of good synthetic data. The fixture businesses used in
[evals](ai-cfo-engine.md#7-evaluation) are the same ones used to seed staging, which makes them a
shared investment: realistic, messy, seasonal, with known-correct answers.

---

## 2. Topology

```
                    CloudFront (WAF, TLS 1.3)
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
      Next.js frontend               ALB (private subnets)
      (edge/serverless)                     │
                          ┌─────────────────┼──────────────────┐
                          ▼                 ▼                  ▼
                   ECS: api           ECS: reason        ECS: workers
                   (autoscaled)       (separate pool)    (ingest/forecast/
                          │                 │             report/alerts)
                          └────────┬────────┴──────────────────┘
                                   ▼
              ┌────────────────────┼─────────────────────┐
              ▼                    ▼                     ▼
       RDS Postgres          ElastiCache            S3 (raw archive,
       Multi-AZ + replica    (cache + BullMQ)        Object Lock, PDFs)
```

**Why `reason` is a separate ECS service from day one** (restating
[architecture §4](architecture.md#4-service-boundaries) because it's a deployment decision too): LLM
requests are slow, streaming, and failure-prone. Sharing a request pool with page loads means a
provider slowdown exhausts connections and takes down the dashboard — which is exactly the surface
that should stay up when the AI is degraded, since it doesn't depend on the model.

Workers are separate task definitions per queue class so a forecast backlog can't starve alert
delivery.

---

## 3. Infrastructure as code

Terraform, one module per concern, remote state in S3 with DynamoDB locking. Environments are
composed from the same modules with different variables — staging and production differ by size and
data, never by shape, or staging stops predicting anything.

```
infra/
  modules/{network,database,ecs-service,queue,storage,observability,secrets}/
  envs/{staging,production}/
```

Rules: no console changes (drift detection runs nightly and alerts), all resources tagged for cost
attribution, `plan` output posted to the PR and required for review.

---

## 4. CI/CD

```
push → lint + typecheck → unit → integration (Testcontainers Postgres)
     → TENANCY ISOLATION SUITE  ← blocking, no override
     → AI EVAL SUITE            ← blocking on prompt/engine change
     → build + sign image → deploy staging → smoke
     → canary 10% (15 min) → automated rollback on error/latency regression
     → full rollout
```

Two gates are non-standard and deserve their reasoning:

**The tenancy suite blocks with no override path.** It is fast (seconds) and it guards the one
failure mode that ends the company. There is no deadline that justifies skipping it, so the tooling
shouldn't offer the option.

**Prompt changes go through the same pipeline as code.** A prompt is production behavior. Treating
`prompts/` as config that ships without review or evaluation is how a working product silently
regresses — and unlike a code regression, nobody gets a stack trace.

**Deploy cadence:** continuous to staging, at least daily to production. Small, frequent deploys are
a safety property, not a velocity one — the smaller the change, the easier the rollback decision.

**Migrations** run as a separate step before the deploy, expand/contract only, backward compatible
for one release ([schema §6](database-schema.md#6-migration-policy)). Backfills are jobs, never
migrations.

**Feature flags** for anything user-visible, so deploy and release are decoupled and a bad feature is
turned off in seconds rather than rolled back in minutes.

---

## 5. Reliability

**Targets**

| Surface | SLO | Rationale |
|---|---|---|
| App availability | 99.9% (~43 min/mo) | Honest for a seed-stage team. Don't publish 99.99% you can't staff. |
| API P95 latency | < 500 ms | Excludes AI endpoints |
| AI answer P95 | < 12 s | Dominated by model latency |
| Data freshness (banking) | < 4 h during business hours | Product-visible, so it's a real commitment |
| Nightly forecast completion | 100% by 6am local | The weekly brief and alerts depend on it |

**Degradation ladder** — the product must fail in layers rather than all at once:

1. LLM provider down → dashboard, alerts, forecasts, and reports all keep working. Chat shows a
   clear status. **This is the single most valuable resilience property we have**, and it exists
   because numbers come from the metric engine, not the model.
2. One connector down → other sources continue; affected metrics show stale-data state with the
   as-of time; answers state which figures are affected.
3. Cache down → degraded latency, correct results.
4. Read replica down → failover to primary, degraded throughput.

**Disaster recovery**
- RDS automated backups, 30-day retention, PITR to any second
- Cross-region snapshot replication
- **RTO 4h, RPO 15min** — and, critically, *tested quarterly* by restoring to a scratch environment
  and running the golden-fixture suite against it. An untested backup is a hypothesis.
- The raw payload archive in S3 is the deepest recovery layer: given raw payloads, the entire
  canonical store and every derived metric can be rebuilt. This is worth stating explicitly because
  it changes the risk calculus on normalization bugs — they are recoverable, not permanent.

---

## 6. Cost model

Illustrative monthly infrastructure at three scales. **These are planning estimates from list
pricing and assumed usage, not quotes** _[verify before using in a financial model]_.

| Line | 100 businesses | 1,000 | 10,000 |
|---|---|---|---|
| ECS (api, reason, workers) | $300 | $1,200 | $7,000 |
| RDS Postgres Multi-AZ + replica | $200 | $900 | $4,500 |
| ElastiCache | $60 | $250 | $1,200 |
| S3 + CloudFront | $40 | $200 | $1,500 |
| Observability | $150 | $500 | $2,500 |
| **Infrastructure subtotal** | **~$750** | **~$3,050** | **~$16,700** |
| Plaid (per item/mo) | $300 | $3,000 | $30,000 |
| LLM inference | $600 | $5,500 | $48,000 |
| **Total COGS** | **~$1,650** | **~$11,550** | **~$94,700** |
| Per business / month | ~$16.50 | ~$11.55 | ~$9.47 |

The shape matters more than the values: **infrastructure is not the cost problem — Plaid and
inference are**, together roughly 80% of COGS at every scale. Two consequences:

1. Optimizing container costs is close to a waste of engineering time. Optimizing
   [model routing](ai-cfo-engine.md#9-cost-management) is not.
2. Plaid's per-item pricing is a fixed tax per customer that doesn't improve with scale until we
   have the volume to renegotiate. That's the strongest long-term argument for direct bank
   connections — a Phase 4 cost play, not a capability play.

Margin implications in [pricing §7](../04-business/pricing.md#7-cogs-and-gross-margin).

---

## 7. Operational practices

- **On-call** from the first paying customer. Two engineers rotating weekly, with a documented
  escalation path. Alerts page only for customer-impacting conditions; everything else is a ticket.
- **Runbooks** for each degradation mode in §5, each connector's failure modes, and the DR restore.
  Written before they're needed, tested during the quarterly DR exercise.
- **Error budget:** 99.9% allows ~43 min/month. Exceeding it two months running freezes feature work
  in favor of reliability. This is worth agreeing on before it's contentious.
- **Nightly reconciliation sweep** across all connectors comparing our totals to source totals;
  divergence pages. This catches silent data corruption, which is the failure that hurts most and
  alerts least.
