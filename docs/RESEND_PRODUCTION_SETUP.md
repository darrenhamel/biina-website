# BIINA.ai — Resend Production Setup (transactional email)

Operator guide to activate **real transactional email** for the invite-only beta using
[Resend](https://resend.com). BIINA's email adapter (`apps/web/src/server/email/index.ts`)
calls the Resend REST API directly over `fetch` (no SDK). Email is required for
**verification, password reset, and org-invite** mail — production **refuses** the dev/mock
provider (those messages would silently never arrive). Auth/security emails are sent
**without open/click tracking**.

> **Posture.** `RESEND_API_KEY` is a **secret** — secrets manager / server `.env` only,
> **never committed, never pasted into chat or tickets, never logged.** `EMAIL_FROM` must
> be a **verified sender** on a domain you control.

Related: [`DOMAIN_VERIFICATION.md`](./DOMAIN_VERIFICATION.md) ·
[`CLOUDFLARE_PRODUCTION_SETUP.md`](./CLOUDFLARE_PRODUCTION_SETUP.md) (DNS lives there) ·
[`AUTHENTICATION.md`](./AUTHENTICATION.md) · [`STAGING_DEPLOYMENT.md`](./STAGING_DEPLOYMENT.md)

---

## What you'll end up with

Server-side environment values (`RESEND_API_KEY` is secret):

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=__set_out_of_band__
EMAIL_FROM=BIINA <no-reply@biina.ai>
EMAIL_REPLY_TO=support@biina.ai        # optional
```

---

## 1. Create the Resend account — HUMAN ACTION (account / billing)

> **HUMAN ACTION.** Creating the Resend account, accepting terms, and choosing a paid plan
> are **human-only**. Claude Code / automation must not create the account or add billing.

Sign in to Resend and create the workspace for BIINA.

---

## 2. Add and verify the sending domain — HUMAN ACTION (DNS)

> **HUMAN ACTION — DNS.** Publishing DNS records is human-only. Claude Code / automation
> must not change DNS.

1. In Resend → **Domains → Add domain**, add your sending domain (e.g. `biina.ai`).
2. Resend generates **SPF, DKIM, and DMARC** records. Publish them at your DNS provider
   (these are added in Cloudflare — see
   [`CLOUDFLARE_PRODUCTION_SETUP.md`](./CLOUDFLARE_PRODUCTION_SETUP.md)). These records are
   **public by design** (they are not secrets), but only the domain's DNS operator can set
   them.
3. Wait for Resend to show the domain **Verified**. Until then, mail will not send from
   `@biina.ai`.

---

## 3. Create an API key

In Resend → **API Keys → Create API Key**:

1. Scope it to **sending** for this domain.
2. The key is **shown once**. Copy it straight into the secrets manager as
   `RESEND_API_KEY`. If lost, revoke and mint a new one — do not guess.

> `RESEND_API_KEY` is a secret. Do not commit it, paste it into a ticket/chat, or log it.

---

## 4. Wire the app environment

Set on the app host / secrets manager (never commit; the API key is secret):

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=__set_out_of_band__
EMAIL_FROM=BIINA <no-reply@biina.ai>       # must be on the VERIFIED domain
EMAIL_REPLY_TO=support@biina.ai            # optional
```

If `EMAIL_PROVIDER=resend` but `RESEND_API_KEY` or `EMAIL_FROM` is missing, the adapter
throws and `validate:production` marks it a **BLOCKER**. Restart / redeploy the app so it
reads the new environment.

---

## Verify

1. **Config** — `validate:production` reports `Email … resend configured (from set)` (see
   below).

2. **Real verification email in staging** — the honest end-to-end test:
   - In **staging** (with the same Resend config, or a staging sender), **sign up** a real
     address you control.
   - Confirm the **verification email actually arrives** and the link verifies the
     account. This exercises the live Resend send path — not a mock.
   - Optionally trigger a **password reset** and an **org invite** and confirm both arrive.

3. **No tracking on auth mail** — auth/security emails are sent without open/click
   tracking by design.

4. **No secret leakage** — confirm the API key never appears in logs; the adapter logs
   only `provider`, redacted recipient, subject, and (on failure) status.

---

## What Claude / CI can check

- `npm run validate:production -w apps/web` — a non-`resend` provider in production is a
  **BLOCKER**; `resend` without `RESEND_API_KEY` + `EMAIL_FROM` is a **BLOCKER**; a
  complete config reports OK. It never prints a secret value.
- `npm run smoke:production -w apps/web` (with `BASE_URL=https://<app-host>`) — confirms
  the deployment is up and no secret-shaped value leaks in the health payload.

Automation can run these read-only checks. It must **not** create the Resend account, add
billing, or publish DNS records — those are HUMAN ACTIONS.
