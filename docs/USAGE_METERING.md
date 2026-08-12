# BIINA.ai — Usage Metering

How BIINA records AI usage independently of any provider, so it owns its own
accounting layer.

---

## Principle

```
User → BIINA entitlement check → BIINA quota check → routing → provider
     → usage returned → BIINA usage ledger
```

BIINA's accounting never depends on RunPod/Ollama/OpenAI/etc. Token counts come
from the gateway's normalized usage metadata (never invented); everything else is
BIINA's own.

## The usage ledger (`usage_events`)

One row per AI request that **reached a provider** — success, error, cancelled,
or timeout. Pre-generation rejections (quota/entitlement/budget) do **not** create
ledger rows (no provider was used).

Captured (no prompt/response text — see [Privacy](#privacy)):
`requestId` · `userId` · `conversationId` · `biinaModelSlug` · `providerType` ·
`providerModelId` · `persona` · `workload` · `plan` · input/output/total tokens ·
estimated input/output/total cost · currency · TTFT · generation & total latency ·
`fallbackUsed` (+ fallback provider/model) · `providerAttempts` (per-attempt
operational costing) · `status` · `failureCategory` · `countedAgainstQuota` ·
timestamps.

**Idempotency:** the ledger is unique on `requestId` and writes with
`onConflictDoNothing`, so retries / duplicate deliveries never double-count.

## Lifecycle

```
Pre-generation:  authenticate → plan → entitlement → context size → budget → quota → concurrency
Generation:      stream from the routed provider
Post-generation: normalize usage → estimate cost → write ledger (idempotent) → release concurrency
```

Accounting runs in the AI service's `finally`, so it fires on **completion, Stop,
provider error, and fallback** — not only on clean completion.

## Status & quota policy

| Outcome | ledger `status` | `countedAgainstQuota` |
|---|---|---|
| Completed | `success` | **yes** |
| User pressed Stop | `cancelled` | **yes** (partial usage recorded) |
| Provider error | `error` | **no** (users aren't penalized for provider faults) |
| Timeout | `timeout` | **no** |

Cancelled generations record whatever reliable usage exists — **never fabricated
output tokens**.

## Fallback accounting

When a request fails over, `providerAttempts` records **both** attempts (for
operational cost), `fallbackUsed=true` names the serving provider/model, and the
user is charged **one** request (no double counting).

## Aggregation

Dashboards use SQL aggregates (no per-token scans): user day/month windows,
platform spend, per-provider/model/plan/persona/workload breakdowns, top users,
and per-model economics. Indexes: `(userId, createdAt)`, `(providerType,
createdAt)`, `(biinaModelSlug, createdAt)`, `(plan, createdAt)`, `status`,
`requestId (unique)`.

## Privacy

The ledger **never** stores prompt or response text — only accounting metadata
keyed by `requestId` / `conversationId`. Accounting analytics are separate from
conversation content; no admin usage view exposes private conversations. See
[COST_CONTROLS.md](./COST_CONTROLS.md) and [PLANS_AND_ENTITLEMENTS.md](./PLANS_AND_ENTITLEMENTS.md).

## Consumer language

Internally everything is token-accurate. The user-facing usage page speaks in
plain terms ("AI usage", requests, remaining allowance) and can later present
credits/messages without changing the internal token ledger.

## Switches

`USAGE_METERING_ENABLED` / `COST_TRACKING_ENABLED` / `BUDGET_CONTROLS_ENABLED`
(env) turn subsystems on/off. Business **rules** (plan limits, budgets) live in
the DB / admin control plane, not env.
