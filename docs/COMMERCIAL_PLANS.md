# BIINA.ai — Commercial Plans & Pricing

How BIINA plans become sellable offerings. Entitlements live in `plans`
(Phase 5); commercial packaging lives in `commercial_prices` (Phase 7).

## Plans (entitlement, unchanged)

`FREE`, `PRO`, `BUSINESS`, `ENTERPRISE` (+ `ADMIN` as an internal entitlement).
Limits, allow-lists, and feature eligibility are defined per plan in `plans` and
edited in Admin → AI/Plans. Billing changes *which* plan an account is on; it
never changes what a plan means.

## Commercial prices

A `commercial_price` packages a plan for sale:

- `planSlug` — the entitlement granted.
- `displayName` — customer-facing ("Pro — Monthly").
- `providerPriceId` — the vendor handle (non-secret, never a plan id).
- `currency` + `amount` (**minor units**: fils/cents).
- `billingInterval` (`month`/`year`) + `billingIntervalCount`.
- `trialDays`, seat readiness (`includedSeats`/`maxSeats`/`perSeatBilling`).
- `enabled`, `publiclyAvailable`, `isTest`.

One plan → many prices (monthly/annual, AED/USD). Example:

```
Plan PRO
 ├── Pro — Monthly (AED 49 / month)   price_…
 ├── Pro — Annual  (AED 490 / year)   price_…
 └── Pro — Monthly (USD 13 / month)   price_…   (all entitle PRO)
```

## Currencies (UAE-first, multi-currency by design)

Each price defines its own currency. Seed defaults are **AED**; **USD** and
others are supported by adding prices. MRR/ARR and revenue are reported **per
currency** and never summed across currencies without an FX strategy.

## Seeded test prices

`scripts/seed.ts` seeds placeholder **test** prices (Pro & Business, monthly &
annual, AED), marked `isTest: true`. They use env `STRIPE_PRICE_*` ids if
provided, else clearly-fake `price_test_*` ids. **These are not production
prices** — real prices are configured by an admin before launch.

## Admin management

Admin → Billing manages commercial prices (create/edit, enable/disable, public
visibility) and the commercial/tax config. Provider **secret** configuration is
never exposed through admin APIs — only the non-secret provider price id, which
maps to an approved commercial offering.

## Plan → capability (entitlement-defined, not billing-defined)

Which models a plan may use is defined by the plan's entitlements/routing
(Phase 4/5), not by billing code. A paid plan change flows through
`plan_assignment → users.plan → EntitlementService → routing`, so allowed models
update immediately without any Stripe-specific logic.

## Tax

Tax is a configurable layer (`billing_config`: `taxEnabled`, `taxMode`,
`taxInclusive`, `taxRegistrationNumber`, `taxRateReference`) — never buried in
checkout code, never assumed. Production tax treatment **requires business/tax
verification** before live billing (see `PRODUCTION_BILLING_CHECKLIST.md`).
