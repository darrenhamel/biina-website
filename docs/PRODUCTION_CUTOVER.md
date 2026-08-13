# Production Cutover Checklist — BIINA.ai

Everything that must be **true and verified** before the ordered go-live sequence in
[`GO_LIVE_RUNBOOK.md`](./GO_LIVE_RUNBOOK.md). This is a **state** checklist (is it ready?);
the runbook is the **action** sequence (do it in order). Work top to bottom; do not start
the runbook until every launch-critical box is checked or explicitly waived by a named
owner.

Status legend: ☐ pending · ✅ done · ⛔ BLOCKER · ⚠️ acceptable-for-beta

Related: [`STAGING_DEPLOYMENT.md`](./STAGING_DEPLOYMENT.md) ·
[`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md) ·
[`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md) ·
[`V1_FEATURE_FLAGS.md`](./V1_FEATURE_FLAGS.md) ·
[`CURRENT_LAUNCH_STATUS.md`](./CURRENT_LAUNCH_STATUS.md)

---

## 1. DNS & TLS — REQUIRES INFRASTRUCTURE / HUMAN ACTION

- [ ] `app.biina.ai` (or `<production-host>`) DNS points at the edge/app.
- [ ] TLS certificate valid, auto-renewing; HTTPS enforced; HSTS at the edge.
- [ ] `NEXT_PUBLIC_APP_URL` matches the production host exactly.

## 2. Production secrets — validated by `validate:production`

- [ ] All `__placeholder__` values in [`../.env.production.example`](../.env.production.example)
      replaced with real values in the hosting **secret manager** (never committed, never logged).
- [ ] `AUTH_SECRET` and `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` are strong 32+ char randoms.
- [ ] `npm run validate:production -w apps/web` → **0 BLOCKERs** (non-zero exit gates deploy).

## 3. Database — managed + migrated

- [ ] Managed Postgres provisioned (`pgvector` available if `VECTOR_STORE=pgvector`).
- [ ] `DATABASE_URL` points at it (`sslmode=require`); validator accepts it.
- [ ] Migrations 0000–0015 applied; from-scratch validation done per
      [`PRODUCTION_DATABASE_VALIDATION.md`](./PRODUCTION_DATABASE_VALIDATION.md).
- [ ] Production seed run (plans + deployment profiles only).

## 4. Storage — durable object storage — REQUIRES INFRASTRUCTURE

- [ ] `FILE_STORAGE_PROVIDER=s3`/`r2` with a real bucket (local FS is a production BLOCKER).
- [ ] ⛔ **Durable storage is a prerequisite for Files/RAG** — if not ready, those features
      stay flagged off.

## 5. Vector store

- [ ] `VECTOR_STORE` set (`pgvector`, or the portable `jsonb` default for beta — ⚠️
      rebuildable from source docs). See [`VECTOR_STORAGE.md`](./VECTOR_STORAGE.md).

## 6. AI provider + primary model route — REQUIRES INFRASTRUCTURE

- [ ] ⛔ **A real production inference endpoint is configured** (`AI_DEFAULT_PROVIDER` ≠
      `mock`; `mock` is refused in production by code). **None is configured yet** — this is
      the headline blocker.
- [ ] Primary model route selected in the admin model registry (env-ref base URL/key set
      out-of-band). See [`MODEL_ROUTING.md`](./MODEL_ROUTING.md) · [`AI_PROVIDER_RUNBOOK.md`](./AI_PROVIDER_RUNBOOK.md).
- [ ] Embeddings provider configured if RAG is enabled.

## 7. Email — REQUIRES INFRASTRUCTURE

- [ ] Real sender configured (`RESEND_API_KEY` or `SMTP_URL`); code default is
      `mock`/console. Verification/reset/invite mail depends on this.

## 8. Billing — TEST until approved

- [ ] `BILLING_LIVE_MODE=false` (Stripe **TEST**). Live keys only after the live-billing
      activation gate is complete (see [`BILLING_RUNBOOK.md`](./BILLING_RUNBOOK.md) and
      `LIVE_BILLING_ACTIVATION.md` when present).
- [ ] Stripe webhook endpoint reachable; signature-verified + idempotent (already IMPLEMENTED).

## 9. OAuth callbacks

- [ ] Connector OAuth redirect/callback URLs registered for the **production** host.
- [ ] `CONNECTOR_WRITE_ACTIONS_ENABLED` stays `false` unless a connector is validated for launch.

## 10. Workers

- [ ] External worker/cron deployed and reachable (the tick caller). See §11.

## 11. Scheduler — tick secret + cron — REQUIRES INFRASTRUCTURE

- [ ] `WORKFLOW_TICK_SECRET` set (production value).
- [ ] External cron/worker calls `POST /api/internal/workflows/tick` with header
      `x-workflow-tick-secret` on a schedule (e.g. every minute).
- [ ] ⛔ Verified: without both, **scheduled workflows silently do not run** (endpoint
      returns `503` when the secret is unset). See [`SCHEDULER.md`](./SCHEDULER.md).

## 12. Monitoring

- [ ] APM/log sink wired; log redaction on by default (no secrets in logs).
- [ ] `/api/health` polled by an uptime monitor; alert on `503`.
- [ ] Dashboards per [`OBSERVABILITY.md`](./OBSERVABILITY.md).

## 13. Backups — taken + restore-tested

- [ ] Automated backups enabled on the managed DB.
- [ ] A restore has been **tested** (not just configured) per
      [`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md) and
      [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md).

## 14. Feature flags — conservative v1

- [ ] Flags set per [`V1_FEATURE_FLAGS.md`](./V1_FEATURE_FLAGS.md). Risky flags **off**
      unless validated for this tier: `AGENT_WRITE_ACTIONS_ENABLED`,
      `WORKFLOW_SCHEDULED_WRITES_ENABLED`, `PUBLIC_LIBRARY_ENABLED`,
      `PUBLIC_CREATOR_PUBLISHING_ENABLED`, `PAID_MARKETPLACE_ENABLED`, `VOICE_MODE_ENABLED`,
      `SAML_ENABLED`, `SCIM_ENABLED`. `validate:production` warns when any are ON.
- [ ] `ALLOW_DEV_FEATURES_IN_PROD=false` in production.

## 15. Access control — invite-only cohort

- [ ] Beta cohort access mechanism chosen (invite codes / admin-created invitations / beta
      flag using existing auth — **not** a frontend-only gate). See
      [`GO_LIVE_RUNBOOK.md`](./GO_LIVE_RUNBOOK.md#beta-cohort-access-control).

---

## Sign-off

| Area | Owner | Status | Date |
|---|---|---|---|
| Infra / DNS / TLS | `<owner>` | ☐ | |
| Database | `<owner>` | ☐ | |
| AI inference endpoint | `<owner>` | ☐ | |
| Billing (TEST) | `<owner>` | ☐ | |
| Security / secrets | `<owner>` | ☐ | |
| Go-live approver | `<owner>` | ☐ | |

Track outstanding items in [`LAUNCH_BACKLOG.md`](./LAUNCH_BACKLOG.md). When every
launch-critical box is checked, proceed to [`GO_LIVE_RUNBOOK.md`](./GO_LIVE_RUNBOOK.md).
