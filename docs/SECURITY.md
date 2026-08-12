# BIINA.ai — Security Posture

The security invariants for the product app. Companion docs:
`AUTHENTICATION.md` (identity), `AUTHORIZATION.md` (roles/IDOR),
`ORGANIZATIONS.md` (tenancy).

## Secrets

- AI provider **base URLs and API keys are server-side only**. They never reach
  the browser and are **never logged**. Provider rows in the DB store only
  env-var *reference names* + a "configured?" boolean — never values.
- No secrets in git. `.env*` is git-ignored; `.env.example` stays complete and
  secret-free.
- `AUTH_SECRET` and `DATABASE_URL` are env-only. The email provider is selected
  by env (`EMAIL_PROVIDER`); credentials for a real provider would be env-only.

## Passwords & tokens

- Passwords hashed with **bcrypt cost 12**. Plaintext is never stored, never
  logged, never returned by any API, never shown in an admin screen.
- Session tokens and email (verify/reset) and invitation tokens are stored as
  **SHA-256 hashes only**. The raw value exists just long enough to go into a
  cookie or a link. Email/invite tokens are **single-use + expiring**, consumed
  atomically so a race can't double-spend them.

## Sessions

`httpOnly`, `SameSite=lax`, `Secure` in production. Server-authoritative
(`getCurrentUser`) — a forged cookie loads nothing. Suspending/disabling an
account or resetting a password **revokes sessions immediately**. Users can list
their devices and revoke individually or all-others.

## CSRF

Defense in depth:

1. Session cookies are `SameSite=lax`, which already blocks cross-site
   cookie-bearing form POSTs.
2. Middleware adds an explicit **same-origin check** on every state-changing API
   request (`POST/PUT/PATCH/DELETE`): if an `Origin` header is present and its
   host ≠ the request host, the call is refused with 403. Browsers always send
   `Origin` on `fetch`, so cross-site calls are caught; same-origin
   server/tooling calls without `Origin` are unaffected.

## CORS

The API is **same-origin by design** — the browser talks only to the app's own
`/api/*`. No permissive `Access-Control-Allow-Origin` is set, so other origins
can't read authenticated responses. The UI never calls a model vendor directly;
all AI traffic goes through `POST /api/ai/chat` on the same origin.

## Security headers (`next.config.mjs`)

Applied to every response: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-DNS-Prefetch-Control: off`, `Cross-Origin-Opener-Policy: same-origin`,
`Permissions-Policy` (camera/mic/geolocation/topics disabled). **HSTS**
(`max-age=2y; includeSubDomains; preload`) is emitted **in production only** (it
must never pin localhost dev). A strict **CSP** is deferred to Phase 7, where
production asset origins are fixed.

## Rate limiting

Auth surfaces (login/signup/forgot/reset/verify-resend/invite) are rate-limited
per (action + client) key to blunt brute force and abuse. Per-instance,
best-effort; replaceable with a shared store without changing call sites.

## Enumeration resistance

- Login returns a single generic "incorrect email or password".
- Forgot-password **always** returns the same generic success, whether or not the
  account exists.
- Org endpoints return **404** for non-members — identical to "doesn't exist",
  so membership/existence never leaks.

## Tenant isolation & IDOR

Access is derived from the authenticated user + server-verified membership, never
from a client-supplied id. `resolveOrgContext` is the single trusted resolver;
per-entity operations are scoped by the owning id in the `WHERE` clause. See
`AUTHORIZATION.md`.

## Logging & privacy

- Structured logs **never** contain passwords, tokens, session values, API keys,
  or provider URLs. Emails are redacted in email-send logs.
- The usage ledger records **no prompt/response content**.
- **Hidden model reasoning is never stored; internal system prompts are never
  exposed** through any API. (Carried from earlier phases; unchanged.)
- Security events (`security_events`) capture *what happened* (login success/
  failure, password change, role/status change, org events) with coarse
  `ip`/`userAgent` — never secrets.

## Account lifecycle

`ACTIVE` / `SUSPENDED` / `DISABLED`. Non-active accounts can't authenticate and
have their sessions cut immediately. Platform-role changes are **SUPER_ADMIN
only**; an ADMIN cannot escalate anyone.

## Explicitly NOT in Phase 6

MFA/TOTP, OAuth/social login, enterprise SSO/SAML/SCIM, admin **impersonation**,
and payment processing are **not** implemented. The schema/permission seams are
left open for them without reworking the core. No paid cloud/email provisioning
was performed.

## Known limitations

- Rate limiting and metrics are **in-process** — correct for a single instance;
  a horizontal deployment needs a shared store (documented seam).
- CSP is not yet enforced (Phase 7).
- Email is a dev provider — no mail is actually delivered until a real adapter is
  configured; dev links are surfaced only outside production.
