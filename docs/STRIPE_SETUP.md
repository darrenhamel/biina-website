# BIINA.ai — Stripe Setup (Test Mode)

How to run billing locally in **test mode**. No real charges. Never commit keys.

## 1. Keys (test)

From the Stripe Dashboard in **Test mode**, get:

- `STRIPE_SECRET_KEY` (`sk_test_…`)
- `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`)

Put them in `.env` (git-ignored). Keep `BILLING_LIVE_MODE=false` — a `sk_test_`
key can never enter live mode even if the flag is set.

```env
BILLING_ENABLED=true
BILLING_LIVE_MODE=false
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...   # from `stripe listen`, step 3
APP_URL=http://localhost:3000
```

## 2. Prices

Either create test prices in Stripe and set `STRIPE_PRICE_*` before seeding, or
let `npm run db:seed` seed placeholder `price_test_*` ids. For a real checkout to
succeed the `provider_price_id` on each `commercial_price` must be a **real test
price id** from your Stripe account — edit them in Admin → Billing, or set the
`STRIPE_PRICE_*` env vars and re-seed.

## 3. Local webhook forwarding

Install the Stripe CLI, then forward events to the local webhook route:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhooks/stripe
```

`stripe listen` prints a `whsec_…` signing secret — put it in
`STRIPE_WEBHOOK_SECRET`. The route verifies every event's signature against it.

## 4. Test a checkout

1. Start the app (`npm run dev -w apps/web`) and sign in.
2. Go to `/en/pricing`, choose Pro → hosted checkout.
3. Pay with a **test card** (e.g. Stripe's standard test card number, any future
   expiry, any CVC — see Stripe's testing docs).
4. The `checkout.session.completed` + `customer.subscription.*` webhooks arrive
   via `stripe listen`; the app re-fetches the subscription and upgrades the
   account to Pro.

## 5. Test lifecycle

- **Cancel / resume:** Settings → Billing (or the billing portal).
- **Renewals / trials without waiting:** use Stripe **test clocks** to advance
  subscription time, or trigger events with `stripe trigger` — the test suite
  never waits real calendar time.
- **Payment failure:** use a failing test card to exercise `PAST_DUE` / grace.

## 6. Safety

- `BILLING_ENABLED=false` disables checkout entirely (pricing page still renders).
- `BILLING_LIVE_MODE` requires an `sk_live_` key **and** the explicit flag; it is
  never inferred. Do not switch to live keys until every item in
  `PRODUCTION_BILLING_CHECKLIST.md` is complete.

> This document intentionally contains **no** real secret keys. Read secrets from
> your local `.env` (git-ignored) or your secret manager.
