# BIINA.ai — Subscriptions

The subscription lifecycle and how it drives entitlements. See
`BILLING_ARCHITECTURE.md` for the layering.

## Statuses (normalized)

Provider states are mapped to a normalized set: `TRIALING`, `ACTIVE`,
`PAST_DUE`, `CANCELED`, `INCOMPLETE`, `UNPAID`, `PAUSED`. We never treat every
subscription as active.

## Entitlement per status

| Status | Access | Notes |
|--------|--------|-------|
| `TRIALING` | Yes (plan) | source = TRIAL; ends at trial/period end. |
| `ACTIVE` | Yes (plan) | Through the current period; renewal extends it. |
| `PAST_DUE` | Yes, during grace | Kept until `currentPeriodEnd + BILLING_GRACE_DAYS`. |
| `CANCELED` (scheduled) | Yes until period end | `cancel_at_period_end` keeps access; status stays ACTIVE until the end. |
| `CANCELED` (ended) | No | Falls back to the next active assignment or FREE. |
| `UNPAID` | No | Beyond grace. |
| `PAUSED` / `INCOMPLETE` | No | No entitlement. |

Decision logic is the pure `decideEntitlement` (unit-tested in
`test/billing-entitlements.test.ts`).

## Checkout

```
Pricing → choose Pro → POST /api/billing/checkout { commercialPriceId }
   → server validates the commercial price (our UUID; browser never sends a provider id)
   → resolve/create billing customer → provider checkout session (idempotency key)
   → redirect to hosted checkout → (payment) → webhook confirms → entitlement active
```

Free requires no checkout. Pro is self-service. Business checkout attaches to the
**organization** (owner-only, controlled beta). Enterprise is **Contact Sales** /
manual admin assignment — no self-service price is invented.

## Upgrade / downgrade

`POST /api/billing/subscription/change { subscriptionId, commercialPriceId }`
swaps the price; **proration is handled by the provider** (explicit
`create_prorations`, configurable in the adapter). The entitlement follows the
new plan once the provider confirms.

## Cancellation & resume

- Cancel defaults to **at period end** (`POST …/subscription/cancel`,
  `atPeriodEnd: true`) — the subscription record is **not** destroyed and access
  continues until the paid period ends.
- A pending cancellation can be undone before period end
  (`POST …/subscription/resume`). Local state updates only after confirmed
  provider state.

## Payment failure & grace

A failed renewal moves the subscription to `PAST_DUE`. Access continues for
`BILLING_GRACE_DAYS` (default 3) past the period end; after that, or on `UNPAID`,
the account falls back to FREE. Behavior is deterministic and configurable — no
instant access removal on the first failed attempt.

## Expiration

When paid access ends the subscription's `plan_assignment` expires and
`recomputeEffectivePlan` transitions the account to its next active assignment or
**FREE**. **No account is deleted; no conversations are deleted.**

## Trials

Commercial prices carry `trialDays` (configurable; not hard-coded). Whether a
trial needs a card up front is a config decision passed to the adapter
(`requirePaymentMethodForTrial`). A trial that ends without a paid subscription
falls back to FREE. Basic per-account trial history exists via the subscription
record; sophisticated fraud prevention is deliberately out of scope.

## Organization subscriptions

An org subscription attaches to the **organization** (via checkout metadata /
billing customer), setting `organizations.plan_slug` — never the owner's personal
plan. Member entitlement propagation from the org plan is a documented readiness
seam (controlled beta); see `ORGANIZATIONS.md`.

## Reconciliation

Webhooks are primary, but `reconcileSubscriptions` (admin: `POST
/api/admin/billing/reconcile`) compares local records to provider state and heals
drift. It is manual now; a scheduled job can call the same function later.
