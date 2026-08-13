# Go-Live Runbook — BIINA.ai

The **exact ordered sequence** to take BIINA.ai live to the approved **invite-only** cohort.
Do the steps in order; do not skip. Each step has a **gate** — if it fails, stop and resolve
before continuing. This runbook assumes [`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md)
is fully checked.

Related: [`STAGING_DEPLOYMENT.md`](./STAGING_DEPLOYMENT.md) ·
[`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md) ·
[`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md) ·
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) ·
[`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md) ·
[`LAUNCH_DAY_RUNBOOK.md`](./LAUNCH_DAY_RUNBOOK.md)

> Convention below: `<host>` = production host (e.g. `app.biina.ai`); commands run against
> production secrets in the hosting environment.

---

## The sequence

### 1. Confirm no BLOCKERs

```bash
npm run validate:production -w apps/web
```

**Gate:** exit code `0`, output shows **0 blocker(s)**. A non-zero exit means do not
proceed. (Prints no secrets.)

### 2. Backup the database

Take a fresh, verified backup **before** any change. See
[`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md).
**Gate:** backup completes and is listed/restorable.

### 3. Validate secrets

All production secrets present in the secret manager; `validate:production` already
confirmed presence (step 1) **without printing values**.
**Gate:** no missing-secret WARNING/BLOCKER for launch-critical keys.

### 4. Migrate

```bash
npm run db:migrate -w apps/web        # 0000 → 0015
```

**Gate:** all migrations apply cleanly. For a first-time DB, follow
[`PRODUCTION_DATABASE_VALIDATION.md`](./PRODUCTION_DATABASE_VALIDATION.md) and run
`npm run db:seed:production -w apps/web` (plans + deployment profiles only).

### 5. Deploy the app

Roll out the production container image (repo `Dockerfile`; `node apps/web/server.js`, port
`3000`, non-root `biina`).
**Gate:** container healthy; process up.

### 6. Deploy the worker

Bring up the external worker/cron host that will drive the scheduler.
**Gate:** worker running and able to reach `<host>`.

### 7. Deploy the scheduler / cron

Configure the cron to call the tick on a schedule (e.g. every minute):

```bash
curl -fsS -X POST https://<host>/api/internal/workflows/tick \
  -H "x-workflow-tick-secret: <WORKFLOW_TICK_SECRET>"
```

**Gate:** returns `200` (not `401`/`503`). A `503` means the secret is unset →
**scheduled workflows will silently not run**. A `401` means the header/secret mismatch.

### 8. Health checks

```bash
curl -fsS https://<host>/api/health
```

**Gate:** `200 { status: "ok" }` with `checks.app`, `checks.database`, `checks.config`,
`checks.aiGateway` all `ok`. Admin detail: `GET /api/admin/production-readiness`.

### 9. Smoke tests

As an admin/test invitee: sign in → send a chat → confirm streaming → reload (persistence).
**Gate:** the core path works end-to-end against production.

### 10. Enable approved feature flags

Set only the flags approved for this tier per [`V1_FEATURE_FLAGS.md`](./V1_FEATURE_FLAGS.md).
Keep risky flags off (agent/scheduled writes, public library/marketplace, voice, SAML/SCIM)
unless explicitly validated.
**Gate:** re-run `validate:production` — no unexpected flag WARNINGs.

### 11. Confirm real AI inference

Send a **live test prompt** through `POST /api/ai/chat` and confirm a real model response
(streamed).
**Gate — HARD BLOCK:** if no real production endpoint is configured (`AI_DEFAULT_PROVIDER`
is `mock` or unset), this **step BLOCKS the launch**. `mock` is refused in production by
code; there is **no real endpoint configured yet**, so this must be provisioned first. See
[`AI_PROVIDER_RUNBOOK.md`](./AI_PROVIDER_RUNBOOK.md) · [`MODEL_ROUTING.md`](./MODEL_ROUTING.md).

### 12. Confirm cost controls

Verify per-plan quotas/entitlements, budget limits, and the circuit breaker are active
before real traffic. See [`COST_CONTROLS.md`](./COST_CONTROLS.md) ·
[`COST_CONTROL_RUNBOOK.md`](./COST_CONTROL_RUNBOOK.md) · [`USAGE_METERING.md`](./USAGE_METERING.md).
**Gate:** quotas enforce; breaker trips on the configured threshold in a controlled test.

### 13. Confirm monitoring

Uptime monitor polling `/api/health`; APM/logs flowing (redacted); alerts wired. See
[`OBSERVABILITY.md`](./OBSERVABILITY.md).
**Gate:** a synthetic alert fires and is received.

### 14. Confirm billing state

`BILLING_LIVE_MODE=false` (Stripe **TEST**). Webhooks signature-verified + idempotent.
**Gate:** billing is in TEST mode (live billing stays off until separately approved).

### 15. Open access to the approved cohort

Enable access **only** for the approved invite-only cohort (see
[Beta cohort access control](#beta-cohort-access-control)).
**Gate:** access limited to invitees; general public cannot self-serve in.

### 16. Monitor

Watch health, error rate, TTFT, AI cost, and queue/tick lag for the initial window. Begin
capturing metrics for [`BETA_UNIT_ECONOMICS_REVIEW.md`](./BETA_UNIT_ECONOMICS_REVIEW.md).

---

## Beta cohort access control

Control who gets in using **existing auth**, never a frontend-only gate:

- **Invite codes** — issue codes redeemable at signup; unredeemed = no account.
- **Admin-created invitations** — an admin (bootstrapped via
  `BOOTSTRAP_ADMIN_EMAIL=… npm run bootstrap:admin -w apps/web`) creates/approves accounts;
  the org invitation journey already exists.
- **Beta flag** — a server-enforced allowlist/flag gating access at the API/auth layer.

Whichever is chosen, enforcement is **server-side**. Keep the mechanism recorded in
[`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md#15-access-control--invite-only-cohort).

---

## Rollback

**Trigger rollback if any of these occur after step 15:**

- `/api/health` returns `503` and does not recover within the agreed window.
- Real AI inference fails/errors for the cohort (step 11 regresses).
- Elevated error rate or cost-control breach (breaker tripping repeatedly).
- A data-integrity or security concern is identified.

**Procedure:**

1. **Close access** — disable the cohort mechanism (invite codes / flag) so no new sessions
   start. This is the fastest containment; the app can stay up read-only for existing sessions.
2. **Redeploy the previous known-good app image** (roll the container back).
3. **Database:** migrations 0000–0015 are **additive** (no destructive DDL), so a rolled-back
   app remains compatible with the migrated schema — **do not** drop columns to roll back.
   Only restore from the step-2 backup if data corruption is confirmed, per
   [`BACKUP_RESTORE_RUNBOOK.md`](./BACKUP_RESTORE_RUNBOOK.md) /
   [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md).
4. **Communicate** — follow [`INCIDENT_RESPONSE.md`](./INCIDENT_RESPONSE.md); record the
   cause before re-attempting go-live.
5. **Re-run this runbook from step 1** once the cause is fixed.

> Because the schema is additive-only, app rollback is low-risk; the destructive path
> (restore) is reserved for confirmed data corruption.
