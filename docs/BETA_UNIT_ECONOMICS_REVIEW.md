# Beta Unit Economics Review — BIINA.ai

A structured review to run at **10, 50, and 100 users** during the invite-only beta, **so
that commercial plan limits are set from evidence, not guesses**. Until this review is
complete, all plan limits are an **INITIAL BETA CONFIGURATION** — deliberately conservative
placeholders, not final pricing.

> **No numbers are invented here.** This document defines **what to measure** and **the
> decision each metric informs**. Fill the tables with real data captured from
> [`USAGE_METERING.md`](./USAGE_METERING.md), [`OBSERVABILITY.md`](./OBSERVABILITY.md), and
> billing.

Related: [`COST_CONTROLS.md`](./COST_CONTROLS.md) ·
[`COMMERCIAL_PLANS.md`](./COMMERCIAL_PLANS.md) ·
[`PLANS_AND_ENTITLEMENTS.md`](./PLANS_AND_ENTITLEMENTS.md) ·
[`INFRASTRUCTURE_COST_MODEL.md`](./INFRASTRUCTURE_COST_MODEL.md)

---

## Why "INITIAL BETA CONFIGURATION"

The seeded plan catalog (`FREE`/`PRO`/`BUSINESS`/`ENTERPRISE`/`ADMIN`) ships with
entitlement **schema defaults** that an operator tunes via the admin plan editor — never via
committed secrets. Those defaults are **starting guardrails to prevent runaway cost during
beta**, not validated commercial limits. This review converts them into evidence-based
limits before any public/commercial launch.

---

## Metrics to measure

For each metric: **what it is**, **where it comes from**, and **the decision it informs**.
Do **not** finalize plan limits until you have real values across the three checkpoints.

| Metric | What it measures | Source | Decision it informs |
|---|---|---|---|
| **AI cost per user** | Inference spend ÷ active users, over a period | Metering × provider rate | The floor under every paid tier and the FREE-tier subsidy ceiling |
| **Tokens per session** | Input+output tokens per conversation/session (median + p90) | Metering | Per-session/context caps; where truncation/summarization should trigger |
| **RAG usage** | Share of sessions using file/RAG retrieval; retrievals per session; corpus size per user | Metering + storage | Whether Files/RAG needs its own quota; storage cost allocation |
| **Web-search usage** | Share of sessions invoking web search; calls per session | Metering (if enabled) | Whether search is metered/limited per plan or gated behind higher tiers |
| **TTFT** (time to first token) | Latency to first streamed token (median + p90) | Observability | Inference capacity sizing; whether concurrency caps are too tight/loose |
| **Error rate** | Failed/aborted AI requests ÷ total (by cause) | Observability/logs | Reliability gate before opening access wider; provider fallback need |
| **Conversion** | FREE → paid upgrade rate (TEST billing during beta) | Billing (TEST) | Plan boundary placement; which features drive upgrades |

Supporting context: **cost per user** should be read against
[`INFRASTRUCTURE_COST_MODEL.md`](./INFRASTRUCTURE_COST_MODEL.md) (fixed infra) to get true
blended unit economics, and against the active caps in [`COST_CONTROLS.md`](./COST_CONTROLS.md).

---

## Checkpoint tables (fill with real data)

### At 10 users — smoke / sanity

| Metric | Median | p90 | Notes |
|---|---|---|---|
| AI cost per user | `<measure>` | `<measure>` | Establish the measurement pipeline works |
| Tokens per session | `<measure>` | `<measure>` | |
| RAG usage (% sessions) | `<measure>` | — | |
| Web-search usage (% sessions) | `<measure>` | — | Only if enabled |
| TTFT | `<measure>` | `<measure>` | |
| Error rate | `<measure>` | — | Investigate every error at this scale |
| Conversion (TEST) | `<measure>` | — | |

**Purpose:** confirm metering/observability are accurate; catch any pathological outlier.

### At 50 users — early trend

Same rows. **Purpose:** first credible per-user cost distribution; spot whether a small
number of heavy users dominate spend (informs fair-use/soft caps).

### At 100 users — decision point

Same rows. **Purpose:** the dataset used to **replace** the INITIAL BETA CONFIGURATION with
proposed commercial plan limits.

---

## Decision framework

Before finalizing commercial plan limits, answer:

1. **Does the median paid user cost less than the intended price?** If not, the plan limit or
   price is wrong. (Use blended cost incl. infra.)
2. **Do the top ~10% of users blow the budget?** If yes, add per-plan soft caps / fair-use
   limits rather than raising everyone's price.
3. **Which features drive cost vs. drive conversion?** Gate cost-heavy, low-conversion
   features (e.g. web search, large RAG corpora) behind higher tiers.
4. **Is TTFT/error rate acceptable at 100 users?** If not, resolve capacity/reliability
   before widening access — a scale trigger (see
   [`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md#scale-triggers)) may
   fire first.

**Output:** a proposed plan-limit table (superseding the INITIAL BETA CONFIGURATION),
reviewed by a named owner, then applied via the admin plan editor and reflected in
[`COMMERCIAL_PLANS.md`](./COMMERCIAL_PLANS.md).

---

## Guardrails during the review

- Keep AI cost controls **on** the whole time (quotas, budgets, circuit breaker) so a bad
  outlier cannot run up unbounded spend while you gather data.
- Billing stays **TEST** (`BILLING_LIVE_MODE=false`) until limits are finalized **and** live
  billing is separately approved.
