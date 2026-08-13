# BIINA.ai — Live Billing Activation

The human checklist that gates flipping `BILLING_LIVE_MODE=true`. Until **every** item below
is explicitly complete, **Stripe stays in TEST mode** and BIINA.ai charges no real money.

Grounded in the current state: `BILLING_LIVE_MODE=false` in the env examples, and the code
already **verifies Stripe webhook signatures and enforces idempotency**. The
`validate-production.ts` guard emits a **BLOCKER** if `BILLING_LIVE_MODE=true` while
`STRIPE_SECRET_KEY` is not a `sk_live_` key — so a half-configured live mode fails safe rather
than silently mischarging.

> **This is a HUMAN + BUSINESS + LEGAL process, not a code change.** Nothing in this repo can
> complete it. Do not enable live charges before Subscription and Refund terms have passed
> legal review ([`LAUNCH_BACKLOG.md`](./LAUNCH_BACKLOG.md) LB-17). See also
> [`PRODUCTION_BILLING_CHECKLIST.md`](./PRODUCTION_BILLING_CHECKLIST.md),
> [`STRIPE_SETUP.md`](./STRIPE_SETUP.md), [`BILLING_ARCHITECTURE.md`](./BILLING_ARCHITECTURE.md).

---

## Gating checklist (all required before `BILLING_LIVE_MODE=true`)

### Account & entity
- ☐ Legal business entity + bank account verified with the payment provider.
- ☐ Live Stripe account **approved/activated** (out of test/restricted state).
- ☐ Tax registration + tax configuration set for the selling jurisdiction(s).

### Products & pricing
- ☐ Live products + prices created (not test-mode price IDs); values from a real pricing
  decision — `<price-placeholder>` until set.
- ☐ Currency confirmed (`<currency>`), matching plan definitions.
- ☐ Plan → price mapping matches the seeded plan catalog.

### Policies (require legal review — LB-17)
- ☐ Subscription Terms — **REQUIRES LEGAL REVIEW** (required before any live charge).
- ☐ Refund / Cancellation policy — **REQUIRES LEGAL REVIEW**.
- ☐ Terms of Service + Privacy Policy published and linked.

### Support & operations
- ☐ Support contact + billing-dispute path published (`<support-contact>`).
- ☐ Dunning / failed-payment handling decided.

### Technical activation (secrets set out-of-band, never committed)
- ☐ Live API key: `STRIPE_SECRET_KEY=sk_live_…`.
- ☐ Live webhook endpoint created in Stripe pointing at the production app.
- ☐ Live webhook signing secret: `STRIPE_WEBHOOK_SECRET=whsec_…` (validator checks shape).
- ☐ Webhook delivery verified end-to-end in live mode (a real event reaches the app and is
  processed idempotently).
- ☐ `BILLING_LIVE_MODE=true` **only after** all of the above.

---

## Activation sequence

1. Complete every checklist item above; obtain explicit business + legal sign-off.
2. Set live secrets in the secrets manager (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
3. Set `BILLING_LIVE_MODE=true`.
4. Run `npm run validate:production` — confirm **`OK Billing` (live mode with a live key)**
   and **0 blockers**. (If the key is not `sk_live_`, the validator BLOCKS the deploy.)
5. Perform one real live-mode transaction end-to-end (subscribe → webhook → entitlement),
   then a cancellation/refund per policy.
6. Monitor webhook success rate (`billing.webhook.route_error`) — see
   [`OBSERVABILITY.md`](./OBSERVABILITY.md) and [`BILLING_RUNBOOK.md`](./BILLING_RUNBOOK.md).

---

## What the code already guarantees

- Webhook **signature verification** + **idempotency** (safe to replay events).
- `validate-production.ts` **blocks** `BILLING_LIVE_MODE=true` without a `sk_live_` key.
- Test mode is the **safe default** — a free invite-only beta needs none of the above.

**Recommendation:** keep billing in TEST mode for the initial invite-only beta (free), and run
this activation only when a paid tier is explicitly approved.
