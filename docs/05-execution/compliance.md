# Compliance Roadmap

> Not legal advice. This is an engineering and operations plan; every item below needs review by
> qualified counsel before it's relied on. Items marked _[counsel]_ specifically require a lawyer's
> judgment, not an engineer's reading.

---

## 1. The strategic question: what to chase, and what to skip

Compliance work is expensive and consumes engineering time that could go to product. The discipline
is knowing which certifications actually unblock revenue and which are theater at our stage.

| Framework | Do we need it? | When | Why |
|---|---|---|---|
| **SOC 2 Type II** | **Yes** | Type I by mo 12, Type II by mo 18 | Firms and larger customers will ask. It's the price of the accountant channel. |
| **GLBA safeguards** | **Likely yes** _[counsel]_ | From day one | We may be a "financial institution" under the FTC's broad definition. Assume yes and build accordingly. |
| **State privacy laws** (CCPA/CPRA et al.) | Yes, at thresholds | Build for it from day one | Cheap if designed in, expensive to retrofit. |
| **PCI DSS** | **No** | — | We never touch card data. Design keeps it that way. |
| **ISO 27001** | Not yet | Post Series A | Matters for international/enterprise. SOC 2 covers our buyers. |
| **HIPAA** | No | — | Unless we target healthcare specifically, which we don't. |
| **GDPR** | Not yet | Before EU launch | Design accommodates it; don't pay for it before we sell there. |
| **FINRA / SEC registration** | No | — | We don't give investment advice. Maintaining that boundary is a product constraint (§5). |

**The two decisions worth calling out:**

- **PCI DSS is avoided by architecture, not by compliance work.** We never store, process, or
  transmit card data — Stripe holds it, and we consume aggregates. Keeping that true is worth
  defending, because entering PCI scope would be a permanent tax.
- **ISO 27001 and GDPR are deliberately deferred.** Both are real, both cost six figures in time and
  fees, and neither unblocks a single dollar of our beachhead revenue. Revisit when international
  revenue justifies it, not before.

---

## 2. SOC 2 — the sequence that actually works

Most startups treat SOC 2 as a scramble before an audit. The cheaper path is to build the controls as
engineering practice and let the audit observe what already exists.

**Months 1–6 — build the controls into the product**

Nearly everything SOC 2 asks for is already in the engineering plan for independent reasons:

| SOC 2 expectation | Where it already lives |
|---|---|
| Logical access controls | [security §5](../03-engineering/security.md#5-authentication--authorization) — RBAC, mandatory MFA |
| Encryption at rest and in transit | [security §4](../03-engineering/security.md#4-encryption) |
| Audit logging | `audit_log` + `data_access_log`, append-only |
| Change management | CI gates, PR review, [deployment §4](../03-engineering/deployment.md#4-cicd) |
| Vulnerability management | SAST/DAST/SCA in pipeline |
| Backup and recovery | RTO 4h / RPO 15min, tested quarterly |
| Vendor management | Subprocessor inventory with DPAs |
| Incident response | Runbooks, severity ladder, blameless reviews |

**Months 6–9** — engage a compliance platform (Vanta/Drata) for continuous monitoring; write the
policy set; select an auditor; run a readiness assessment.

**Months 9–12** — Type I audit (point-in-time). Unblocks most sales conversations.

**Months 12–18** — Type II observation window (6–12 months) and report.

**Cost estimate** _[verify]_: $8–15K/yr platform, $20–40K audit, plus roughly 0.25 FTE of engineering
time. Budget it as a real line item rather than absorbing it silently.

**The single most useful practice:** treat every SOC 2 control as an engineering requirement with a
test, not a document. A control that exists only in a policy PDF will fail during the observation
window, and a control with a CI test cannot silently rot.

---

## 3. GLBA — assume it applies

The FTC's Safeguards Rule defines "financial institution" broadly, and a company aggregating consumer
and business financial data plausibly falls inside it _[counsel — get a written determination early;
this changes obligations materially]_.

Building as if it applies costs little because the requirements overlap heavily with SOC 2:

- A written information security program with a named qualified individual
- Risk assessment, access controls, encryption, MFA — already planned
- Vendor oversight
- **Breach notification within 30 days** for incidents affecting 500+ consumers
- Annual reporting to the board

**The one genuinely additional obligation is the notification timeline**, which needs to be in the
incident response runbook with the clock defined, not discovered during an incident.

---

## 4. Privacy

**Design principles that make privacy compliance mostly automatic:**

1. **Minimize collection.** We don't need SSNs, full bank credentials, or card numbers. Every field
   not collected is a field that can't leak and can't be subject to a deletion request.
2. **Purpose limitation, stated plainly.** Financial data is used to provide the service. Aggregated,
   anonymized data may be used for benchmarking — **disclosed prominently, not buried**, because the
   benchmarking product depends on it ([pricing §9](../04-business/pricing.md#9-long-term-monetization)).
3. **Deletion means deletion.** 30-day soft delete, then purge; backups aged out within 90 days;
   deletion certificate issued.
4. **Export without friction.** Machine-readable, on demand. Making it easy to leave is a trust
   signal for a product asking to see everything.

**Consumer vs. business data.** Most state privacy laws protect *consumers*, and our customers are
businesses — but sole proprietors blur the line, and our users are individuals with personal data
(names, emails, access logs). Build to the consumer standard; it's simpler than maintaining two
regimes and the delta is small.

**The benchmarking disclosure deserves specific care.** Using aggregated customer data to build a
product we sell is legitimate and common, and it is also exactly the kind of thing that generates
betrayal narratives when discovered rather than disclosed. It belongs in the privacy policy in plain
language, in onboarding, and ideally with an opt-out — the opt-out rate will be low and the goodwill
is worth more than the marginal data.

---

## 5. Product boundaries with legal weight

Three lines the product must not cross, enforced in the AI's safety check
([ai-cfo-engine §5](../03-engineering/ai-cfo-engine.md#5-the-verifier)) rather than left to prompt
discipline:

| Boundary | We do | We don't |
|---|---|---|
| **Tax** | Estimate liability to help plan cash; flag deadlines | Advise on filing positions, prepare, or file. Every tax output carries the disclaimer. |
| **Investment** | Analyze the business's own financial position | Recommend securities or investment allocations |
| **Credit / lending** | Model the cash impact of a loan the user is considering | Broker, originate, or take undisclosed referral revenue |

The credit boundary is the one most likely to erode, because knowing exactly when a business needs
capital is commercially valuable. Any move here requires prominent disclosure — an advisory product
with hidden lending incentives has a conflict that its core value proposition cannot survive.

**Terms of service must be explicit** that we provide analysis and information, not professional
financial, tax, legal, or investment advice, and that the customer remains responsible for their
decisions _[counsel]_.

---

## 6. Data residency and vendors

**US-only initially** — all data in AWS us-east-1 with cross-region backup within the US. Simplifies
the compliance surface considerably. EU residency becomes a project when EU revenue justifies it.

**Subprocessor inventory** maintained publicly and kept current — customers and auditors both ask:

| Vendor | Data | Control |
|---|---|---|
| AWS | All application data | DPA, encryption, US regions |
| Model provider(s) | Computed aggregates + question text | **Zero-retention configuration, no training on our data**, DPA |
| Plaid | Bank connection | Their own compliance posture; we never see credentials |
| WorkOS | Identity | DPA |
| Stripe | Our billing | PCI on their side |
| Observability vendors | Logs, traces | **No financial data in logs** — enforced by structured logging with field redaction |

Two of these deserve emphasis:

- **The model provider configuration is a compliance-relevant setting, not a preference.** Zero
  retention and no-training must be contractually established and periodically verified.
- **"No financial data in logs" is an engineering control that decays silently.** A developer adding
  a debug log with a transaction payload puts customer financial data into a third-party log system.
  Field-level redaction in the logging layer plus a CI lint rule is the durable version.

---

## 7. Timeline

| Month | Milestone |
|---|---|
| 1–3 | Security controls built in; subprocessor inventory; privacy policy and ToS drafted _[counsel]_ |
| 3–6 | GLBA determination _[counsel]_; incident response runbooks; data retention implemented |
| 6–9 | Compliance platform; policy set; auditor selected; readiness assessment |
| 9–12 | **SOC 2 Type I**; security page published with honest status |
| 12–18 | Type II observation window; first external penetration test; **SOC 2 Type II** |
| 18+ | Annual cadence; ISO 27001 and GDPR evaluated against actual international demand |

---

## 8. What we tell customers, and when

**Honesty about compliance status is a competitive advantage**, not a weakness. The buyer in this
category — especially the accountant — checks.

- Before Type I: *"SOC 2 Type II audit in progress; report expected Q2 2027. Here are the controls
  we've implemented today."* Then list them specifically.
- **Never claim a certification we don't hold.** It's fraud, it's checkable, and in a professional
  community it ends the channel.
- **Never claim end-to-end encryption.** It isn't true for a product that computes over the data, and
  claiming it would be a lie a security-literate buyer catches immediately
  ([security §4](../03-engineering/security.md#4-encryption)). The precise, honest description is
  stronger.

The general principle: state exactly what is true, in specific terms, including the gaps. A buyer who
finds a gap you disclosed trusts the rest of your claims. A buyer who finds one you hid discards all
of them.
