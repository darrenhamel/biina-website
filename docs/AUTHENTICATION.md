# BIINA.ai — Authentication

How identity works in the product app (`apps/web`). Phase 6 hardened the
existing session auth rather than replacing it: the model was already sound
(server-authoritative sessions, hashed tokens), so we deepened it instead of
swapping libraries for fashion.

> **Never** store plaintext passwords, log passwords, return password hashes
> through any API, or render a hash in an admin screen. All four are enforced by
> construction — no code path exposes `passwordHash`.

## Sessions

- **Password hashing:** `bcryptjs`, cost factor **12** (`server/auth/password.ts`).
- **Session tokens:** a cryptographically-random raw token is set in an
  `httpOnly`, `SameSite=lax`, `Secure`-in-production cookie (`biina_session`).
  Only the token's **SHA-256 hash** is stored in `sessions`. A DB leak can't be
  replayed as a session.
- **Server-authoritative:** `getCurrentUser()` (`server/auth/session.ts`) is the
  single trusted resolver. It looks the session up by hash, joins the user, and
  returns `null` for any non-`ACTIVE` account — so **suspension/disable takes
  effect immediately**, on the very next request, without waiting for the cookie
  to expire.
- **Session metadata:** each session records `userAgent`, coarse `ip`, and a
  throttled `lastUsedAt` (updated at most once/minute) to power the "active
  sessions" screen. Raw IPs are never surfaced to the client.
- **Middleware** does only a cheap cookie-presence gate for `/{locale}/app/*`
  (fast redirect). It is **not** authorization — every server route re-derives
  the user with `getCurrentUser()`.

## Auth flows

All state-changing auth endpoints are `POST`, Zod-validated, rate-limited
(`server/lib/rate-limit.ts`), and write a **security event**
(`server/auth/events.ts`, best-effort — logging never breaks the flow).

| Flow | Endpoint | Notes |
|------|----------|-------|
| Sign up | `POST /api/auth/signup` | Creates account, sends a verification email (dev link surfaced only outside production). |
| Log in | `POST /api/auth/login` | Generic "incorrect email or password" (no enumeration). Suspended/disabled accounts are refused. |
| Log out | `POST /api/auth/logout` | Revokes the current session. |
| Change password | `POST /api/auth/change-password` | Verifies the current password, then **revokes all other sessions**. |
| Forgot password | `POST /api/auth/forgot-password` | **Always** returns the same generic success — no account enumeration. Emails a single-use reset link only if the account exists. |
| Reset password | `POST /api/auth/reset-password` | Atomically consumes a hashed, 1-hour, single-use token, then **revokes every session**. |
| Verify email | `POST /api/auth/verify-email` | Consumes a hashed, 24-hour, single-use token. |
| Resend verification | `POST /api/auth/resend-verification` | Auth-only, tightly rate-limited. |
| List sessions | `GET /api/auth/sessions` | The user's own devices (coarse fields only). |
| Revoke a session | `DELETE /api/auth/sessions/:id` | Scoped to the caller's own sessions. |
| Sign out others | `POST /api/auth/sessions/revoke-others` | Keeps the current session. |

## Email verification & reset tokens

`server/auth/tokens.ts`:

- Tokens are random 32-byte values; **only the SHA-256 hash** is stored
  (`email_tokens`). The raw token is returned once, to the caller, for the link.
- **Single-use + expiring:** consume is an atomic
  `UPDATE … SET used_at = now() WHERE token_hash = $1 AND type = $2 AND used_at
  IS NULL AND expires_at > now() RETURNING user_id`. Two concurrent requests
  can't both succeed; an expired or reused token returns `null`.
- TTLs: verify **24h**, reset **1h**.

## Email delivery

Identity depends only on the `EmailProvider` interface (`server/email`), never a
commercial vendor. Phase 6 ships a **development provider** that logs a redacted
record and, **outside production only**, surfaces the action link for local
testing. SMTP/Resend/SES adapters can be added later without touching a single
caller. See `EMAIL_PROVIDER` / `EMAIL_DEV_LINKS` in `.env.example`.

## Rate limiting

In-memory sliding window per (action + client) key. Presets: login 10/min,
signup 5/min, forgot 5/min, reset 10/min, verify-resend 3/min, invite 20/min.
Per-instance and best-effort; a shared store (Redis) can replace it without
changing call sites.

## Account status

`ACTIVE` → normal. `SUSPENDED` / `DISABLED` → `getCurrentUser()` returns `null`
and every session is revoked at the moment status changes, so access is cut off
immediately (see `server/ai/admin.ts::setUserStatus`).

## Deliberately out of scope (Phase 6)

MFA/TOTP, OAuth/social login, and enterprise SSO/SAML/SCIM are **not**
implemented. The schema and permission seams leave room for them; adding them
later does not require reworking sessions. See `docs/AUTHORIZATION.md` for roles
and `docs/ORGANIZATIONS.md` for tenancy.
