# BIINA.ai — Disaster Recovery

Recovery plans for major failure scenarios. Pair with `BACKUP_RESTORE_RUNBOOK.md`
(mechanics) and `INCIDENT_RESPONSE.md` (coordination).

DR owner: `<infra-owner>` · Incident commander: `<incident-commander>`

---

## Provisional objectives (RPO / RTO)

> **PROVISIONAL — not yet validated by a DR drill.** These are recommended
> starting targets to agree with the business, not commitments. Confirm/adjust
> after the first restore drill and set per-tier SLAs with `<business-owner>`.

| Scenario | Provisional RPO | Provisional RTO |
|---|---|---|
| Database failure (managed failover) | ≤ 5 min (PITR) | ≤ 30 min |
| Database loss → restore from dump | last backup (`<db-backup-cadence>`) | ≤ 2–4 h |
| Object storage loss | last storage backup | ≤ 2 h (+ vector rebuild) |
| Vector store loss | 0 (rebuildable from source) | rebuild time (cost-bound) |
| AI provider outage | 0 (no data loss) | provider-dependent; fail over/degrade |
| Region outage | ≤ replication lag | `<multi-region-RTO>` (REQUIRES INFRA) |
| Bad deployment | 0 | ≤ 15 min (rollback) |

RPO = max acceptable data loss; RTO = max acceptable downtime.

---

## Scenarios

### 1. Database failure
- **Detect** — `/api/health` `database: error`; DB connection errors.
- **Recover** — managed HA: fail over to replica (REQUIRES INFRA). No replica:
  restore from snapshot/dump → run migrations → validate → start
  (`BACKUP_RESTORE_RUNBOOK.md` §3–4).
- **Prevent** — automated snapshots + PITR; test restores on `<restore-drill-cadence>`.

### 2. Object storage failure
- **Detect** — file reads fail; uploads error; broken references in UI.
- **Recover** — restore storage backend; reconcile against DB references to avoid
  orphans; if using local disk (current), files on a lost host are unrecoverable
  unless previously backed up.
- **Prevent** — move to durable object store (S3/R2) with versioning before
  production (REQUIRES INFRA).

### 3. AI provider outage
- **Detect** — provider errors/timeouts; admin AI health unhealthy.
- **Recover** — set provider `maintenanceMode`; rely on **policy-respecting**
  fallback to a different compliant provider (`AI_PROVIDER_RUNBOOK.md`). No data
  loss. Sovereign tenants: restore the private provider, never widen policy.
- **Prevent** — configure a compliant fallback model on a second provider;
  monitor provider health.

### 4. Region outage
- **Detect** — an entire region/zone unreachable.
- **Recover** — fail over to a standby region (**REQUIRES INFRA** — cross-region
  replication + DNS failover are not provisioned in this repo). Document the manual
  steps with `<infra-owner>`.
- **Prevent** — multi-AZ DB, cross-region backups, DNS with health-checked failover.

### 5. Worker / scheduler failure
- **Detect** — no `workflow.tick` logs; workflows not firing.
- **Recover** — restart the cron/worker; the DB-authoritative scheduler recovers
  stuck runs and applies the **limited catch-up** (`WORKFLOW_MAX_CATCHUP_RUNS`,
  default 1) — no backlog storm (`WORKFLOW_RUNBOOK.md`).
- **Prevent** — monitor tick liveness; alert on missing ticks; run ≥1 healthy
  worker (multiple are safe — unique run keys prevent double-fire).

### 6. DNS / CDN failure
- **Detect** — site unreachable while origin is healthy; edge errors.
- **Recover** — fail over DNS/CDN per provider runbook (REQUIRES INFRA); keep
  `/api/health` reachable for origin probes.
- **Prevent** — low-TTL DNS with health checks; a documented secondary edge.

### 7. Credential compromise
- **Detect** — leaked/abused secret (`SECURITY_RUNBOOK.md`).
- **Recover** — rotate the secret (`OPERATIONS_RUNBOOK.md` §7); for
  `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, re-encrypt or force reconnect
  (`CONNECTOR_RUNBOOK.md` §5); for `AUTH_SECRET`, expect global re-login.
- **Prevent** — secret manager, rotation cadence, secret scanning, redacted logs.

### 8. Bad deployment
- **Detect** — health `503` / errors / failed smoke test post-deploy.
- **Recover** — re-point to previous build (fast if no migration ran); prefer a
  kill switch for a single feature; roll forward for incompatible migrations
  (`OPERATIONS_RUNBOOK.md` §2).
- **Prevent** — staging + smoke tests + required CI checks (`RELEASE_PROCESS.md`).

### 9. Billing outage
- **Detect** — webhook deliveries failing; subscriptions not updating.
- **Recover** — keep the webhook sink up; fix the fault; **replay** failed events
  (idempotent → safe); reconcile (`BILLING_RUNBOOK.md`).
- **Prevent** — monitor webhook success rate; alert on `billing.webhook.route_error`.

### 10. Search outage
- **Detect** — web/search calls failing across users.
- **Recover** — `RESEARCH_WEB_ENABLED=false` (research continues on internal
  data); interactive search fails clearly; check provider status.
- **Prevent** — monitor the search provider; avoid retry storms.

---

## Rollback strategy (summary)
- **Code, no migration** → re-point to previous build/image; near-instant.
- **Single feature** → kill switch (`OPERATIONS_RUNBOOK.md` §8) — faster than a
  full rollback.
- **Incompatible migration** → roll forward (migrations are forward-only); restore
  from backup only on data corruption.

## Vector rebuild
Vectors are **derived and rebuildable from source documents** — never treat vector
loss as a catastrophe. Restore source docs first, then re-embed/re-index
(`BACKUP_RESTORE_RUNBOOK.md` §5). Mind embedding cost (`COST_CONTROL_RUNBOOK.md`).

## DR readiness checklist
- [ ] Automated DB backups verified + a **test restore** passed.
- [ ] Object storage durable (S3/R2) with versioning.
- [ ] `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` backed up separately from data.
- [ ] Tick liveness + webhook-success + health alerts wired (`OBSERVABILITY.md`).
- [ ] RPO/RTO agreed with the business and drill-validated.
