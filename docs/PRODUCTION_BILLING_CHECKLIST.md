# BIINA.ai — Production Billing Activation Checklist

Do **not** enable live billing until every item is complete. Live mode requires
`BILLING_LIVE_MODE=true` **and** an `sk_live_` key — it is never inferred, and
the app fails safe when configuration is incomplete.

> ⚠️ **TAX CONFIGURATION REQUIRES REVIEW.** Do not assume tax treatment. Stripe
> calculating an amount is not a statement of legal/tax correctness.

## Completed in code

- [x] Provider-independent billing abstraction (`BillingService` → `PaymentProvider`).
- [x] Stripe adapter (fetch + crypto, no SDK), server-side only.
- [x] Two safety flags (`BILLING_ENABLED`, `BILLING_LIVE_MODE`), both default off.
- [x] Plan ↔ commercial price separation; server maps commercial price → provider price.
- [x] Checkout, billing portal, cancel/resume/change flows.
- [x] Signature-verified, idempotent, safe-retry webhooks; re-fetch authoritative state.
- [x] Entitlement sync (subscription → plan_assignment → effective plan), grace + trial + expiry.
- [x] Organization billing (owner-only, attaches to org) — controlled beta.
- [x] Invoices (safe references), manual-vs-paid distinction, entitlement-source tracking.
- [x] Admin billing overview, MRR/ARR (per currency), unit economics, reconciliation.
- [x] Tax config layer (configurable), audit logging, tests.

## Requires human / business action (before charging a real customer)

- [ ] **Legal entity** established (UAE-first): `legalEntityName`, `billingCountry`.
- [ ] **Stripe account** verified: business details, bank account, identity.
- [ ] **Live API keys** provisioned (`sk_live_`, `pk_live_`) and stored in the
      secret manager — never in git.
- [ ] **Live webhook endpoint** registered in Stripe (`/api/billing/webhooks/stripe`)
      with its own `whsec_` signing secret; verify delivery.
- [ ] **Real production prices** created in Stripe; `commercial_prices` updated
      with real `provider_price_id`s and `is_test = false`.
- [ ] **Currency** decisions confirmed (AED / USD / …) and priced per currency.
- [ ] **Tax configuration reviewed** by a qualified party: registration status,
      tax mode (inclusive/exclusive), rate references, invoice requirements,
      supported billing countries. Set `billing_config` accordingly.
- [ ] **Refund / cancellation policy** defined and published.
- [ ] **Legal documents** in place (see below).
- [ ] **Invoice settings** (branding, footer, tax lines) configured in Stripe.
- [ ] **Support contact** set (`billing_config.supportEmail`).
- [ ] Set `BILLING_LIVE_MODE=true` **only after** all of the above.

## Required commercial/legal documents (create if missing)

- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Subscription Terms
- [ ] Cancellation / Refund Policy
- [ ] Acceptable Use Policy

These are **not** written here — they require legal review. This checklist only
flags them as prerequisites.

## Go-live smoke (live mode, one real low-value transaction)

- [ ] Real checkout completes and the webhook upgrades the account.
- [ ] Invoice appears with correct currency + tax lines.
- [ ] Cancel-at-period-end keeps access to period end.
- [ ] Billing portal opens and manages the subscription.
- [ ] Reconciliation reports no drift.
