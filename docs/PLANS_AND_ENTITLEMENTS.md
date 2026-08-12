# BIINA.ai — Plans & Entitlements

DB-backed plans, entitlement checks, and quotas. **No payments** — this is the
internal control system future subscriptions will build on.

---

## Plans (`plans` table)

Plan slugs mirror the `user_plan` enum: **FREE · PRO · BUSINESS · ENTERPRISE ·
ADMIN**. Each plan is admin-editable (Admin → Plans) and defines (null = no limit
for that dimension):

- `dailyRequestLimit` · `monthlyRequestLimit`
- `dailyTokenLimit` · `monthlyTokenLimit`
- `requestsPerMinute` · `maxConcurrent`
- `maxContextTokens` · `maxOutputTokens`
- `allowedModels` · `allowedWorkloads` · `allowedPersonas` (empty = allow all)
- `filesEligible` · `toolsEligible` · `webSearchEligible` (readiness)
- `priorityClass` (readiness for priority routing)

Seed values are **placeholder configuration, not final pricing**.

## Effective plan

A user's effective plan is `users.plan`. Admin assignment updates that slug and
records a `plan_assignments` row with `startsAt`/`endsAt` (trial/expiry/promotion
**readiness** — automatic expiry is a later phase) and `organizationId`
(org-allowance readiness). If the plans table is empty, a safe built-in FREE
fallback keeps the app running.

## ADMIN access is an entitlement, not a bypass

Admins get high/unlimited usage through the **ADMIN plan** (all limits null), not
through scattered code bypasses. This keeps entitlement logic in one place and
auditable.

## Entitlement service (pure)

`server/ai/entitlements.ts`: `canUseModel`, `canUseWorkload`, `canUsePersona`,
`canUseFeature`, `effectiveMaxOutputTokens` (min of plan & model),
`estimateContextTokens`. All AI entitlement decisions are server-side; the
frontend uses these only for UX.

## Quota service (pure)

`server/ai/quota.ts` `evaluateQuota(plan, aggregate, now)` returns
`{ allowed, reason?, resetAt?, remaining* }`. Windows: **per-minute** (rate),
**daily**, **monthly** — all UTC. Resets: next minute / next UTC midnight / first
of next UTC month. Aggregates come from the ledger (only `countedAgainstQuota`
rows). Provider failures don't consume quota.

## Concurrency

`server/ai/concurrency.ts` — per-user in-memory slots (per-instance; documented).
A slot is acquired in preflight and released in the service `finally`, so
completed/cancelled/errored streams free their slot.

## Pre-generation order

```
authenticate → resolve plan → route → entitlement(model/workload/persona)
→ context-size → budget(hard) → quota(day/month/rate) → concurrency → send
```

A rejection throws a typed error mapped to a safe status:

| Condition | code | HTTP | User sees |
|---|---|---|---|
| Model/workload/persona not in plan | `not_entitled` | 403 | "Your plan does not include this." |
| Daily/monthly allowance reached | `quota_exceeded` | 429 | "You've reached your usage limit…" (+ resetAt) |
| Too fast / too many concurrent | `rate_limited` | 429 | "…too quickly / too many running." |
| Conversation exceeds plan context | `context_too_large` | 413 | "This conversation is too long for your plan." |
| Platform hard budget hit | `budget_exceeded` | 503 | "Temporarily unavailable." |

## Admin controls

- **Admin → Plans**: edit every plan's limits/allow-lists; assign a plan to any
  user (audited via `plan.assign`). Normal users **cannot** change their own plan
  (enforced server-side; 403).
- **Output caps**: the effective `maxOutputTokens` (plan ∩ model) is passed to the
  provider (`num_predict` for Ollama, `max_tokens` for OpenAI-compatible) to bound
  runaway generation cost.

## Readiness (not built yet)

Business/enterprise org allowances (`organizationId`), trials/subscriptions
(`startsAt`/`endsAt`), priority routing (`priorityClass`), and youth-safety model
restriction for Kids/Teens (via `allowedModels`) — the schema/architecture support
these; the flows arrive later.
