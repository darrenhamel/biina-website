# BIINA.ai — Billing Runbook

Stripe billing operations. Every procedure follows **detect → act → verify**.

> **Test mode until live.** Billing runs against **Stripe test mode** until a
> human explicitly switches to live keys (`sk_live_…` + a live `whsec_…`). No
> paid-provider go-live without explicit human approval (`CLAUDE.md` hard rule).
> Config validation accepts both `sk_test_` and `sk_live_` shapes — being in test
> mode is a deliberate operator choice, not a config error.

On-call: `<ops-oncall>` · Billing owner: `<billing-owner>` · Stripe dashboard: `<stripe-dashboard-url>`

---

## 0. How the webhook path works (read first)

Sink: `POST /api/billing/webhooks/stripe`
(`src/app/api/billing/webhooks/stripe/route.ts` → `processStripeWebhook`).

- Reads the **raw request body** — no JSON parsing/body-modifying middleware in
  the path (required for signature verification).
- **No session auth / no CSRF**: authenticity comes from the **Stripe signature**
  (`STRIPE_WEBHOOK_SECRET`), because Stripe posts server-to-server with no Origin.
- Return-code contract:
  - `400` — bad/malformed signature → Stripe does **not** retry (and should not).
  - `500` — handler failure → Stripe **retries** (transient; safe to replay).
  - `200` — event recorded/processed, **including idempotent duplicates**.
- Idempotency: events are de-duplicated so a replay/duplicate does not double-apply.

Required config: `STRIPE_SECRET_KEY` (`sk_test_`/`sk_live_`),
`STRIPE_WEBHOOK_SECRET` (`whsec_`). Both are HIGH-severity in production readiness.

See also: `docs/BILLING_ARCHITECTURE.md`, `docs/BILLING_SECURITY.md`,
`docs/PRODUCTION_BILLING_CHECKLIST.md`, `docs/STRIPE_SETUP.md`.

---

## 1. Webhook failures / replay

**Detect** — Stripe dashboard shows failing webhook deliveries (non-2xx), or
`billing.webhook.route_error` in logs; subscriptions not updating after payment.

**Act**
1. Classify by status:
   - **All deliveries `400`** → signature mismatch. The deployed
     `STRIPE_WEBHOOK_SECRET` does not match the endpoint's signing secret. Fix the
     env value (Section 4) and redeploy. Do not "disable verification."
   - **`500`s** → handler/database error. Fix the underlying fault; Stripe retries
     automatically, so once healthy the backlog drains. You can also **Resend**
     failed events from the Stripe dashboard.
   - **Timeouts** → app/DB slow or down (`OPERATIONS_RUNBOOK.md` §4).
2. **Replay safely**: because processing is idempotent, replaying already-applied
   events is safe — they return `200` without double-applying. Use Stripe's
   "Resend" on the failed events after the fault is fixed.

**Verify** — Stripe shows the events delivered `200`; the affected subscriptions
now reflect the correct plan/state in the DB.

---

## 2. Subscription mismatch (DB vs Stripe)

**Detect** — a user's plan/entitlements in BIINA don't match their Stripe
subscription (support report, or reconciliation Section 4).

**Act**
1. Pull the customer + subscription from the Stripe dashboard; note the source of
   truth = Stripe's current subscription status.
2. Check whether the relevant `customer.subscription.*` / `invoice.*` webhook was
   delivered and `200`. If it was missed/failed, **Resend** it — the idempotent
   handler will reconcile the plan.
3. If the event was delivered but the DB is still wrong, treat as a handler bug:
   capture the event id, fix forward, and replay.

**Verify** — user's plan + entitlements match the Stripe subscription; user can
use their plan's features.

---

## 3. Payment issue (declines, failed invoices)

**Detect** — `invoice.payment_failed` events; user reports loss of access.

**Act**
1. Confirm in Stripe whether this is a card decline / dunning (customer action) vs
   a platform fault. Card declines are resolved by the customer updating payment.
2. Ensure the failed-payment webhook applied the intended downgrade/grace behavior
   (per `BILLING_ARCHITECTURE.md`). If not, replay the event.
3. Do **not** manually grant paid entitlements outside the billing flow except as
   a documented, time-boxed support exception approved by `<billing-owner>`.

**Verify** — subscription state and entitlements match Stripe; any grace period
behaves as designed.

---

## 4. Reconciliation

**Detect** — routine check, or after any webhook outage.

**Act**
1. List Stripe subscriptions changed in the outage window (dashboard/API).
2. For each, confirm the corresponding BIINA plan/entitlement matches. Where it
   doesn't, **Resend** the latest relevant event (idempotent → safe).
3. Rotate/verify secrets if the outage was signature-related:
   - Update `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` in env, redeploy, restart.
   - Re-verify with a Stripe test event → expect `200`.

**Verify** — no remaining mismatches; a fresh test event returns `200`.

---

## 5. Disable checkout / pause billing

**Detect** — billing incident, fraud, or a decision to stop new charges.

**Act** (no dedicated single flag — use these layers):
1. **Stop new subscriptions**: disable/hide the checkout entry points (feature the
   checkout UI behind an admin/plan setting) or point checkout at a disabled
   price. Confirm with `<billing-owner>`.
2. **Keep the webhook endpoint up** so existing events still reconcile — do not
   take the sink offline, or you will drop state changes (they will retry, but you
   lose real-time correctness).
3. For a full pause, coordinate with Stripe (pause collection on subscriptions)
   — **REQUIRES human decision**, dashboard action.

**Verify** — no new checkouts complete; existing subscription webhooks still
process `200`.

---

## Do-not-do
- Never disable signature verification or parse the body before verifying.
- Never treat a `400` as retryable — the fix is the secret, not a replay.
- Never flip to live keys without explicit human approval and the production
  billing checklist complete (`PRODUCTION_BILLING_CHECKLIST.md`).
