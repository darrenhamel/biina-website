# BIINA.ai — Billing Security

Security invariants for payments. Extends `docs/SECURITY.md`.

## Secrets

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are **server-side only**, never
  logged, never sent to the browser. Only the **publishable** key may reach the
  frontend (and is not required by the current hosted-checkout flow).
- Provider secret configuration is **never** exposed through admin APIs. Admin
  billing surfaces show only non-secret data (provider price ids, amounts).
- No card data is ever stored. Hosted checkout + hosted billing portal keep raw
  PAN/CVV entirely with the provider (PCI surface minimized — this is **not** a
  claim of formal PCI certification).

## Server-side ownership (no browser trust)

Every billing operation resolves the authenticated scope **server-side**:

```
authenticated user → internal BillingCustomer → provider customer
```

The browser never supplies a `customerId`, `subscriptionId`, or provider
`priceId`. It may only reference **our** commercial-price UUID, which the server
validates and maps to the approved provider price. A forged/foreign UUID is
rejected (400). Subscription operations verify the subscription belongs to the
caller's scope or return 404 (no existence leak).

## Organization billing

```
authenticate → verify org → verify membership → verify billing permission (OWNER)
→ resolve the ORG billing customer → act
```

Members and outsiders cannot manage or view org billing. Org ids are never
trusted alone — membership is always re-verified (IDOR-safe, `requireOrgOwner`).

## Webhooks

- **Signature-verified** (HMAC-SHA256) against the **raw** request body; the
  route reads `req.text()` with no body-modifying middleware. Missing/invalid/
  stale (replay outside tolerance) signatures are rejected with 400.
- **No auth/CSRF** on the webhook route by design — authenticity is the
  signature, not a session; the provider posts server-to-server with no Origin,
  so the same-origin CSRF gate doesn't apply.
- **Idempotent** (unique provider event id) — replays don't double-apply.
- **Never authoritative from the payload** — we re-fetch the subscription's real
  state before granting anything.

## Entitlements are earned, never claimed

A checkout redirect never grants a plan. Only a **verified webhook** (or an admin
manual assignment) changes `users.plan` / `organizations.plan_slug`. A user
cannot self-assign Pro by hitting the success URL or forging a request.

## Idempotency & races

- Checkout uses a provider idempotency key per (customer, price) to blunt
  double-submits.
- Webhook + subscription upsert + entitlement sync are all idempotent, so
  "checkout completes + webhook arrives + user refreshes + another webhook" all
  converge to the provider's authoritative state.

## Manual vs. paid

Admin manual assignments (`source = MANUAL`) are distinct from paid subscriptions
and are **never** represented as fake provider subscriptions. Precedence is
"most-recent active assignment wins," so staff/partner/demo grants and paid
subscriptions coexist predictably.

## Audit

Billing lifecycle events (checkout initiated, subscription activated/changed/
cancel-requested/resumed, invoice paid, webhook processed, price/config changes,
manual assignment) are written to the append-only audit log. Full card data is
never recorded; webhook audit keeps the provider event id, not raw payloads.

## No silent failure

Handler failures are recorded (`billing_webhook_events.status = failed`) and the
route returns non-2xx so the provider retries. Reconciliation can heal drift.
Inconsistent state is logged prominently rather than silently granting
indefinite paid access.

## Tested boundaries

`test/billing-stripe.test.ts` (signature: valid/missing/tampered/wrong-secret/
stale), `test/billing-validation.test.ts` (browser can't pass a provider price
id; live mode never inferred), and the billing smoke (forged price id → 400,
webhook idempotency, cross-scope subscription → 404, failed-webhook retry,
entitlement follows verified state).
