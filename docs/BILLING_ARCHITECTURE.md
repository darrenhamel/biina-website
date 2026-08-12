# BIINA.ai — Billing Architecture

Phase 7 turns the internal plan architecture (Phase 5) into a commercial
subscription system **without coupling BIINA to a payment vendor** and **without
touching the AI architecture**. Companion docs: `SUBSCRIPTIONS.md`,
`COMMERCIAL_PLANS.md`, `BILLING_SECURITY.md`, `STRIPE_SETUP.md`,
`PRODUCTION_BILLING_CHECKLIST.md`.

## The layering

```
BIINA app / routes / UI
        ↓  (only ever calls)
BillingService              server/billing/service.ts
        ↓
PaymentProvider interface   server/billing/provider.ts
        ↓
StripeProvider (adapter)    server/billing/stripe/adapter.ts
        ↓
Stripe REST API
```

The rest of BIINA talks to **`BillingService`** — never to Stripe. Only the
adapter knows vendor specifics. Adding a second provider = a new adapter + a
factory case; the service, routes, entitlements, and UI don't change.

The Stripe adapter is implemented directly against the Stripe REST API with
`fetch` + `node:crypto` (no SDK dependency), the same way the OpenAI-compatible
AI provider is built. Webhook signatures are verified with Stripe's documented
HMAC-SHA256 scheme.

## Plan vs. price (the core separation)

| Concept | Where | Example |
|---------|-------|---------|
| **BIINA plan** — business-domain entitlement | `plans` (Phase 5), `users.plan` | `PRO` |
| **Commercial price** — a sellable offering | `commercial_prices` | "Pro — Monthly, AED 49" |
| **Provider price id** — vendor handle | `commercial_prices.provider_price_id` | `price_1abc…` |

The app **never** treats a provider price id as a plan id. Entitlements always
come from the plan, never from provider metadata. One plan may have many prices
(monthly/annual, AED/USD) — the entitlement stays the same.

## Data model (`server/db/schema.ts`, migration 0004/0005)

- `commercial_prices` — plan ↔ provider price, currency, minor-unit amount,
  interval, trial days, seat readiness, `is_test`, enabled/public flags.
- `billing_customers` — maps a **user or organization** to a provider customer
  (avoids duplicates; unique on provider customer id). No card data.
- `subscriptions` — internal mirror of provider subscription state (status,
  periods, cancel/trial), unique on provider subscription id.
- `billing_invoices` — safe references only (amounts, period, hosted URLs).
- `billing_webhook_events` — idempotency ledger, unique on provider event id.
- `billing_config` — non-secret commercial/tax settings (secrets stay in env).
- `plan_assignments` gained `source` (`DEFAULT`/`MANUAL`/`TRIAL`/`SUBSCRIPTION`/
  `ORGANIZATION`/`PROMOTION`) + `subscription_id`, and `user_id` became nullable
  so an org-scoped assignment can exist.

## Entitlements follow verified billing state

```
Provider webhook (signed)
   → verify + re-fetch authoritative subscription
   → upsert subscriptions row (status/periods)
   → decideEntitlement() → plan_assignment (source SUBSCRIPTION/TRIAL/ORGANIZATION)
   → recomputeEffectivePlan() → users.plan / organizations.plan_slug
   → EntitlementService / QuotaService / routing (Phase 5, unchanged)
```

`decideEntitlement` (pure, `server/billing/entitlements.ts`) grants access for
`ACTIVE`/`TRIALING`, keeps access through a configurable **grace** window on
`PAST_DUE`, keeps access until period end on scheduled `CANCELED`, and confers
nothing on `UNPAID`/`PAUSED`/`INCOMPLETE`. The account's effective plan is then
**recomputed** from its active assignments — the most-recently-created active one
wins, so a later paid subscription upgrades a stale grant and a later manual
grant still overrides a subscription. `source` keeps PAID/MANUAL/TRIAL distinct
for reporting without changing precedence.

**Billing never bypasses Phase 5 quotas.** It only decides *which plan* an
account is entitled to; quota/entitlement/routing enforcement is unchanged.

## Webhooks are authoritative — checkout redirects are not

A successful checkout redirect is **never** treated as payment proof. The
success page shows a pending state; the signed webhook updates subscription +
entitlement. Webhook processing (`server/billing/webhooks.ts`) is:

- **Signature-verified** on the raw body (`/api/billing/webhooks/stripe` reads
  `req.text()` — no body-modifying middleware in the path).
- **Idempotent** — recorded in `billing_webhook_events` (unique event id); an
  already-processed event is skipped; every downstream write is idempotent so a
  previously-failed event can be safely retried.
- **Re-fetching** — the event only tells us *which* subscription changed; we
  re-fetch its authoritative state before syncing.
- **Safe on failure** — a handler error records the failure and returns non-2xx
  so the provider retries.

## Safety flags

Two independent env switches, both default **off**, gate real money. Live mode is
**never** inferred from the presence of keys:

- `BILLING_ENABLED` — checkout/portal/provider writes allowed at all (pricing
  page still renders when off; checkout is disabled).
- `BILLING_LIVE_MODE` — live provider mode; requires the flag **and** an
  `sk_live_` key.

## Where things live

| Concern | File |
|---------|------|
| Provider interface | `server/billing/provider.ts` |
| Stripe adapter | `server/billing/stripe/adapter.ts` |
| Factory / injection | `server/billing/index.ts` |
| Orchestration | `server/billing/service.ts` |
| Entitlement sync | `server/billing/entitlements.ts` |
| Webhooks | `server/billing/webhooks.ts` |
| Price catalog | `server/billing/catalog.ts` |
| Config / flags | `server/billing/config.ts` |
| Analytics (MRR / unit economics) | `server/billing/analytics.ts` |
