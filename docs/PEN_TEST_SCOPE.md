# BIINA.ai — Penetration Test Scope

Scope definition for a **future, independent** security penetration test of the
BIINA.ai product app.

> **No penetration test has been performed.** This document defines what such a
> test should cover. An **independent external review is RECOMMENDED BEFORE any
> broad enterprise or government launch** (including the UAE-sovereign profile).
> Internal automated tests exist (tenant-isolation, auth, billing, routing —
> `apps/web/test/`), but they are **not** a substitute for external pen testing.

Security owner: `<security-owner>` · Vendor: `<pen-test-vendor>` ·
Test window: `<agreed-window>` · Target: **`<staging-host>` only** (never
production, never live third-party provider accounts).

---

## Rules of engagement (summary)
- Test against a dedicated **staging** environment with synthetic data.
- **Mock AI + mock search providers**; do not attack real provider accounts.
- Stripe **test mode**; no real charges.
- Coordinate destructive/DoS testing windows with `<ops-oncall>`.
- Responsible-disclosure + fix-verification process agreed up front.

---

## Scope areas

### 1. Authentication & sessions
- Session cookie handling, `AUTH_SECRET` strength/rotation impact, fixation,
  cookie flags (SameSite/HTTPOnly/Secure), logout invalidation, brute-force/rate
  limiting on login (note: rate limiter is in-memory/per-process today), password
  hashing (bcrypt), account enumeration.
- Middleware auth gate vs authoritative server-side checks (`getCurrentUser`) —
  confirm a forged cookie cannot load real data.

### 2. Authorization & multi-tenant isolation
- Horizontal (cross-user) and cross-**organization** access to conversations,
  files, memory, connectors, workflows, library items.
- Private AI provider isolation: an ORGANIZATION-owned provider must be unusable by
  any other tenant (`satisfiesEnterprisePolicy`).
- Admin/`SUPER_ADMIN` privilege boundaries; IDOR on all id-addressed resources.

### 3. OAuth / connectors
- OAuth `state`/PKCE integrity, redirect-URI validation, token theft/replay, scope
  escalation, callback CSRF.
- Credential storage: AES-256-GCM at rest; confirm keys/tokens never returned to
  client or logged; key-rotation/re-encryption safety.

### 4. File handling & storage
- Upload validation (type/size), path traversal, stored-file access control,
  orphan/broken references, content-type sniffing (`X-Content-Type-Options`),
  SSRF via file/URL ingestion.

### 5. SSRF & outbound requests
- Server-side fetches (web grounding/search, connector calls, URL ingestion) —
  block internal metadata/link-local ranges; sovereign residency must not be
  bypassable via SSRF.

### 6. Billing
- Stripe webhook signature verification (no bypass), idempotency/replay handling,
  price/plan tampering, entitlement escalation, checkout manipulation.

### 7. Agents (autonomous actions)
- Risk-policy enforcement: destructive/financial actions `DENY`; external
  communication `REQUIRE_APPROVAL`; write kill switch (`AGENT_WRITE_ACTIONS_ENABLED`
  default off). Confirm a model-generated plan cannot raise its own risk or bypass
  approval; per-tool kill switches hold.

### 8. Workflows / automation
- Scheduler tick auth (`WORKFLOW_TICK_SECRET`, constant-time), run-key
  duplicate-fire prevention, hard step limits, scheduled-write kill switch,
  privilege of scheduled runs vs their owner.

### 9. Enterprise (SSO/SCIM/residency)
- SAML/SCIM auth flows (when enabled), service-account/SCIM token handling, data
  residency + provider allow-list enforcement, sovereign lockdown
  (`SOVEREIGN_MODE_ENABLED`) cannot be circumvented.

### 10. Admin surface
- Admin API authz (`requireAdmin`), production-readiness/health endpoints leak no
  secret values, AI control-plane changes are audited, budget/hard-limit controls
  cannot be abused to disable safety.

### Cross-cutting
- Security headers / CSP (`middleware.ts`; `CSP_DISABLED` must not be on in prod),
  CSRF same-origin enforcement, injection (SQLi via Drizzle params, XSS, template),
  secret leakage in logs/responses (`REDACT_KEYS`), dependency/supply-chain review.

---

## Deliverables
- Findings with severity (CVSS or agreed scale), reproduction, and remediation.
- Retest of fixed findings.
- An executive summary suitable for enterprise/government due diligence.

## After the test
- Track findings as incidents where warranted (`INCIDENT_RESPONSE.md`).
- Add regression tests for each fixed class.
- Re-test before major launches and after significant architecture changes.

> Bottom line: **external pen test + fix verification is a launch gate for broad
> enterprise/government rollout.** Do not represent the product as pen-tested until
> it has been.
