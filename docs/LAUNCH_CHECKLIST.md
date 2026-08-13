# BIINA.ai — Launch Checklist (Phase 18)

The single master checklist to go from "builds and passes tests" to "serving real users in a
**controlled, invite-only beta**." Work top to bottom; nothing here should be skipped.

> **Honest posture.** This checklist targets an **invite-only beta**, not general
> availability. No item below asserts a certification, compliance, or sovereignty claim.
> Legal items are `REQUIRES LEGAL REVIEW` — this document does **not** draft legal terms.

State legend: **DONE (in code)** · **CONFIGURED** · **REQUIRES INFRASTRUCTURE** ·
**REQUIRES HUMAN ACTION** · **REQUIRES LEGAL REVIEW** · **REQUIRES SECURITY REVIEW**.

Companions:
[`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md),
[`INFRASTRUCTURE_COST_MODEL.md`](./INFRASTRUCTURE_COST_MODEL.md),
[`LAUNCH_DAY_RUNBOOK.md`](./LAUNCH_DAY_RUNBOOK.md),
[`POST_LAUNCH_PLAN.md`](./POST_LAUNCH_PLAN.md),
[`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md),
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md),
[`OBSERVABILITY.md`](./OBSERVABILITY.md).

---

## Product
- ☐ Production build passes (`npm run build`) — **DONE (in code)**.
- ☐ Unit/integration tests pass (~290) — **DONE (in code)**.
- ☐ Migrations `0000`–`0015` apply clean to the production DB — **REQUIRES HUMAN ACTION**.
- ☐ Feature flags set to the conservative v1 scope — **REQUIRES HUMAN ACTION** (see
  [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md)).
- ☐ EN/AR + full RTL verified end to end on production build — **REQUIRES HUMAN ACTION**.
- ☐ Admin bootstrap done via the production-safe script (`BOOTSTRAP_ADMIN_EMAIL`, no
  hard-coded creds) — **REQUIRES HUMAN ACTION**.
- ☐ Production seed **not** run against prod unless intended (`ALLOW_LOCAL_PROD_SEED` is
  test-only) — **REQUIRES HUMAN ACTION**.
- ☐ `/api/health` returns ok for app + database + aiGateway on the deployed instance —
  **REQUIRES HUMAN ACTION**.

## Infrastructure
- ☐ DNS for `app.biina.ai` (+ `biina.ai`) — **REQUIRES HUMAN ACTION**.
- ☐ TLS/HTTPS enforced on all hosts — **REQUIRES INFRASTRUCTURE**.
- ☐ CDN + WAF in front of the app — **REQUIRES INFRASTRUCTURE**.
- ☐ Application host running Node 20+ with secrets injected — **REQUIRES INFRASTRUCTURE**.
- ☐ Worker + scheduler decision made (in-process for beta / separate for scale) —
  **REQUIRES HUMAN ACTION**.
- ☐ Managed Postgres 16 provisioned; `DATABASE_URL` not localhost — **REQUIRES INFRASTRUCTURE**.
- ☐ Object storage provisioned; `STORAGE_PROVIDER=s3|r2` (not local) — **REQUIRES INFRASTRUCTURE**.
- ☐ Vector store decision (PortableVectorStore for beta / `pgvector` for scale) —
  **REQUIRES HUMAN ACTION**.
- ☐ Real AI inference + embedding endpoints (no `mock`) — **REQUIRES INFRASTRUCTURE**.
- ☐ Email provider configured + domain verified (SPF/DKIM/DMARC) — **REQUIRES INFRASTRUCTURE**.
- ☐ Secrets manager holds all critical secrets; startup config validator passes —
  **REQUIRES INFRASTRUCTURE**.
- ☐ Full provisioning walk-through complete — see
  [`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md).

## Security
- ☐ Security headers + CSP active in production (`CSP_DISABLED` unset/false) — **DONE (in code)**.
- ☐ `ALLOW_DEV_FEATURES_IN_PROD` is **false** in production — **REQUIRES HUMAN ACTION**.
- ☐ Auth hardening in place (rate-limited flows, hashed single-use tokens, CSRF/HSTS) —
  **DONE (in code)**.
- ☐ Secrets never in git/logs/browser; connector creds AES-256-GCM encrypted at rest —
  **DONE (in code)** / **REQUIRES HUMAN ACTION** to verify in the live env.
- ☐ Kill switches confirmed for agent writes, research, library/marketplace, enterprise
  (SAML/SCIM/sovereign), and DB-backed AI maintenance mode — **DONE (in code)**.
- ☐ **External penetration test / security review** — **REQUIRES SECURITY REVIEW** (not yet
  performed).
- ☐ Tenant-isolation spot check (Org A ≠ Org B) on the live deployment — **REQUIRES SECURITY
  REVIEW**.

## Billing
- ☐ Stripe currently **TEST mode**; live not activated — **REQUIRES HUMAN ACTION**.
- ☐ Complete [`PRODUCTION_BILLING_CHECKLIST.md`](./PRODUCTION_BILLING_CHECKLIST.md) and
  [`STRIPE_SETUP.md`](./STRIPE_SETUP.md) — **REQUIRES HUMAN ACTION**.
- ☐ Live products/prices created; webhook endpoint verified — **REQUIRES HUMAN ACTION**.
- ☐ Billing safety flags flipped **only** after explicit approval + legal review —
  **REQUIRES HUMAN ACTION**.
- ☐ Decide whether beta is free (recommended) or paid — **REQUIRES HUMAN ACTION**.

## Legal / Business
> These are **REQUIRES LEGAL REVIEW**. This checklist does not draft or approve legal terms.
- ☐ Terms of Service — **REQUIRES LEGAL REVIEW**.
- ☐ Privacy Policy — **REQUIRES LEGAL REVIEW**.
- ☐ Acceptable Use Policy (AUP) — **REQUIRES LEGAL REVIEW**.
- ☐ Subscription Terms — **REQUIRES LEGAL REVIEW** (required before any live charge).
- ☐ Refund / Cancellation policy — **REQUIRES LEGAL REVIEW**.
- ☐ Cookie policy / consent — **REQUIRES LEGAL REVIEW**.
- ☐ Data-processing / residency posture reviewed for target jurisdiction(s) — **REQUIRES
  LEGAL REVIEW** (see [`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md); region tags are **not** a
  compliance claim).
- ☐ Support/contact channel and abuse-report path published — **REQUIRES HUMAN ACTION**.

## Monitoring
- ☐ External uptime check on `/api/health` — **REQUIRES INFRASTRUCTURE**.
- ☐ Error tracking + latency metrics wired — **REQUIRES INFRASTRUCTURE** (see
  [`OBSERVABILITY.md`](./OBSERVABILITY.md)).
- ☐ **AI cost/usage alarm** configured (dominant variable cost) — **REQUIRES HUMAN ACTION**.
- ☐ Centralized logging with retention; no secrets in logs — **REQUIRES INFRASTRUCTURE**.
- ☐ On-call / alert routing decided for the beta window — **REQUIRES HUMAN ACTION**.

## Backups
- ☐ Automated DB backups enabled — **REQUIRES INFRASTRUCTURE**.
- ☐ **At least one restore drill performed and verified** — **REQUIRES HUMAN ACTION** (no
  backup tested yet).
- ☐ Object-storage durability/versioning confirmed — **REQUIRES INFRASTRUCTURE**.
- ☐ Vector store rebuild-from-source procedure confirmed — **DONE (in code)** /
  **REQUIRES HUMAN ACTION** to rehearse. See [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md).

## Support
- ☐ Beta invite/allowlist mechanism ready — **REQUIRES HUMAN ACTION**.
- ☐ Feedback channel for beta users — **REQUIRES HUMAN ACTION**.
- ☐ Known-issues list + escalation path documented — **REQUIRES HUMAN ACTION**.
- ☐ Admin runbook access confirmed (maintenance mode, kill switches) — **REQUIRES HUMAN ACTION**.

## Launch Day
- ☐ Follow [`LAUNCH_DAY_RUNBOOK.md`](./LAUNCH_DAY_RUNBOOK.md) in order — **REQUIRES HUMAN ACTION**.
- ☐ Pre-launch DB backup checkpoint taken — **REQUIRES HUMAN ACTION**.
- ☐ Smoke test passed on production — **REQUIRES HUMAN ACTION**.
- ☐ Rollback threshold + procedure agreed before opening access — **REQUIRES HUMAN ACTION**.

## Post-Launch
- ☐ Execute [`POST_LAUNCH_PLAN.md`](./POST_LAUNCH_PLAN.md) (24h / 7d / 30d) —
  **REQUIRES HUMAN ACTION**.
- ☐ Review AI spend vs model after first day/week — **REQUIRES HUMAN ACTION**.
- ☐ Triage bugs + feedback; schedule the external security review — **REQUIRES HUMAN ACTION**.
