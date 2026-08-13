# BIINA.ai — Operations Runbook

Step-by-step operational procedures for the `apps/web` product app. Each
procedure follows **detect → act → verify**. Commands run from the repo root
unless noted. Substitute `<placeholders>` with your real values.

> Status legend: **IMPLEMENTED** = shipped in code today · **ARCH READY** =
> designed, needs config/infra · **REQUIRES INFRA** = needs infrastructure or a
> human decision not present in this repo.

On-call contact: `<ops-oncall>` · Escalation: `<eng-lead>` · Status page: `<status-page-url>`

---

## 0. Prerequisites & key facts

- App: Next.js 14 (App Router) at `apps/web`, Postgres via Drizzle.
- Health endpoint: `GET /api/health` — checks `app` + `database`. Returns
  `200 {status:"ok"}` or `503 {status:"degraded"}`. **IMPLEMENTED.**
- Admin readiness: `GET /api/admin/production-readiness` (admin session) — reports
  missing/weak config by variable **name + severity only**, never secret values.
- Startup fail-safe: `assertProductionReady()` throws if `NODE_ENV=production`
  (or `BIINA_ENV=production`) and any **CRITICAL** config finding exists
  (`src/server/config/production.ts`).
- Critical env vars: `DATABASE_URL`, `AUTH_SECRET`, `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`,
  `NEXT_PUBLIC_APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `AI_DEFAULT_PROVIDER`, `STORAGE_PROVIDER`.

Migrations are generated **offline** (`npm run db:generate -w apps/web`) and
committed to `apps/web/drizzle/` (currently `0000`–`0015`). They are applied with
`npm run db:migrate -w apps/web`.

---

## 1. Deploy (routine release)

**Detect** — a reviewed, tagged release is ready (see `RELEASE_PROCESS.md`).

**Act**
1. Confirm CI green on the release commit: typecheck, lint, unit + security
   tests, migration validation, production build (`RELEASE_PROCESS.md`).
2. Snapshot the database first (see `BACKUP_RESTORE_RUNBOOK.md`) — never deploy a
   migration without a fresh backup.
3. Set/confirm environment for the target: all critical env vars present.
   Sanity-check locally against a staging DB:
   ```bash
   curl -s https://<staging-host>/api/admin/production-readiness   # admin cookie required
   ```
   Zero CRITICAL / HIGH findings before promoting.
4. Apply migrations against the production DB (idempotent; only pending files run):
   ```bash
   DATABASE_URL='<prod-db-url>' npm run db:migrate -w apps/web
   ```
5. Deploy the new build/image to the web/API tier (**REQUIRES INFRA** — your
   platform's deploy mechanism, e.g. rolling restart of the container/service).
6. Confirm the worker/scheduler cron is pointed at the new release (Section 3).

**Verify**
- `curl -s https://<host>/api/health` → `200` and `database: ok`.
- Admin → production-readiness: 0 CRITICAL.
- Smoke test: login, send a chat message, load history (see `LOAD_TESTING.md`
  smoke list / `RELEASE_PROCESS.md` post-deploy validation).

---

## 2. Rollback (bad deploy)

**Detect** — health `503`, elevated error rate, or a failed smoke test after deploy.

**Act**
1. **Re-point the web/API tier to the previous known-good build/image** and
   restart. Code rollback is fast and safe **if no migration ran**.
2. If a migration ran and is incompatible: prefer **roll forward** (deploy a fix)
   — Drizzle migrations here are forward-only, there is no down-migration script.
   Only restore from backup if data is corrupted (`BACKUP_RESTORE_RUNBOOK.md`).
3. If the cause is a single feature, prefer a **kill switch** (Section 8) over a
   full rollback — it is faster and less disruptive.

**Verify** — `GET /api/health` `200`; error rate back to baseline; smoke test passes.

> **Rollback criteria** (any one triggers rollback): health stays `503` > 5 min,
> error rate > `<threshold>`, checkout/webhooks failing, or auth broken.

---

## 3. Restart worker / scheduler

The workflow scheduler is **DB-authoritative**: no in-memory timers. An external
cron/worker calls `POST /api/internal/workflows/tick` (typically once per minute),
authenticated by the `WORKFLOW_TICK_SECRET` shared secret in the
`x-workflow-tick-secret` header (constant-time compared). If the secret is unset
the endpoint returns `503` and never fires. **IMPLEMENTED (worker/cron = REQUIRES INFRA).**

**Detect** — workflows not running on schedule; queue depth rising; no
`workflow.tick` log lines.

**Act**
1. Verify the cron/worker process is alive and reaching the app.
2. Manual tick to confirm the endpoint works:
   ```bash
   curl -s -X POST https://<host>/api/internal/workflows/tick \
     -H "x-workflow-tick-secret: $WORKFLOW_TICK_SECRET" -H "x-worker-id: manual"
   ```
   Expect JSON `{claimed, executed, recovered, skippedDuplicates}`.
3. Restart the cron/worker if it is dead. Each tick **recovers stuck runs**
   (RUNNING past `WORKFLOW_STUCK_TIMEOUT_MS`, default 10 min → marked `FAILED`)
   and claims due workflows via a UNIQUE `(workflowId, runKey)` so two workers
   never double-fire the same instant.

**Verify** — `workflow.tick` logs resume; `claimed`/`executed` reflect due work;
queue depth drops. See `WORKFLOW_RUNBOOK.md` for missed-run/catch-up policy.

---

## 4. Database issue

**Detect** — `GET /api/health` shows `database: error` (`503`); DB connection
errors in logs.

**Act**
1. Confirm DB reachability from the app tier (network, credentials, connection
   caps). Postgres client 16 available in this environment.
2. Check `DATABASE_URL` is set and does **not** point at localhost (production
   validation rejects localhost).
3. Connection exhaustion: reduce pool size / add pgbouncer (**REQUIRES INFRA**);
   migration script uses `max:1`, seed uses `max:4` — app pool is separate.
4. If the primary is down and you have a managed replica/snapshot, fail over per
   your provider's runbook (**REQUIRES INFRA**) and see `DISASTER_RECOVERY.md`.
5. If migrations are the cause (partial apply), re-run `db:migrate` — it applies
   only pending files and is safe to re-run.

**Verify** — `GET /api/health` → `database: ok`.

---

## 5. AI provider issue

See `AI_PROVIDER_RUNBOOK.md` for full detail. Quick actions:

- **One model degraded** → set `model.maintenanceMode` in Admin → AI control, or
  disable the model. Routing skips models where `enabled=false` or
  `maintenanceMode=true` and falls through the priority chain.
- **A whole provider down** → set `provider.maintenanceMode`/disable it. If
  `fallbackEnabled` and a compliant, different-provider fallback model exists,
  requests fall over automatically (`selectFallback`). **There is no silent
  fallback to a policy-prohibited provider.**
- **All AI down / emergency** → set `ai_settings.maintenanceMode` (Admin →
  AI control) — `selectRoute` throws immediately and users get a generic 503.

---

## 6. Billing webhook issue

See `BILLING_RUNBOOK.md`. Quick facts: webhook sink is
`POST /api/billing/webhooks/stripe`; it reads the **raw body**, verifies the
Stripe signature, and is **idempotent**. Bad signature → `400` (no retry).
Handler failure → `500` (Stripe retries). Success/duplicate → `200`.

---

## 7. Credential / secret rotation

**Detect** — scheduled rotation, or suspected leak (`SECURITY_RUNBOOK.md`).

**Act** (rotate one at a time; deploy env change → restart):
- `AUTH_SECRET` — rotating invalidates existing sessions (users re-login). Plan
  for it; do it during a maintenance window if disruptive.
- `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` — connector credentials are AES-256-GCM
  encrypted with this key. **Rotating it makes existing ciphertext undecryptable**
  unless you re-encrypt. See `CONNECTOR_RUNBOOK.md` §credential rotation for the
  decrypt-with-old → re-encrypt-with-new sequence. Do NOT rotate blindly.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — rotate in the Stripe dashboard,
  update env, redeploy; re-verify webhook delivery (`BILLING_RUNBOOK.md`).
- `WORKFLOW_TICK_SECRET` — update env and the cron/worker header together.
- Provider API keys / base URLs — server-side only, never logged; update env and
  restart. See `AI_PROVIDER_RUNBOOK.md`.

**Verify** — health `200`; the affected subsystem works (login, webhook, connector
refresh, AI chat) end-to-end. Confirm no secret value appears in logs.

---

## 8. Kill switches (disable a feature safely)

All are **server-controlled env flags**; setting one stops execution without
deleting anything. Change env → restart the web/API tier.

| To disable… | Set | Default | Effect |
|---|---|---|---|
| **All agent runs** | `AGENT_EXECUTION_ENABLED=false` | on | No new agent runs accepted |
| **Agent external writes** | `AGENT_WRITE_ACTIONS_ENABLED` unset/false | **off** | Reads work; no external writes execute |
| **Force agent dry-run** | `AGENT_DRY_RUN=true` | off | Plan/preview/reads only |
| **One agent tool** | `AGENT_DISABLED_TOOLS="gmail.send,slack.post"` | — | Named tools blocked |
| **All workflows** | `WORKFLOWS_ENABLED=false` | on | Stops new + scheduled runs |
| **Scheduled runs only** | `WORKFLOW_SCHEDULER_ENABLED=false` | on | Manual still allowed |
| **Scheduled external writes** | `WORKFLOW_SCHEDULED_WRITES_ENABLED` unset/false | **off** | Scheduled reads keep working |
| **One workflow tool** | `WORKFLOW_DISABLED_TOOLS="gmail.send"` | — | Named tool blocked in automations |
| **Advanced research** | `ADVANCED_RESEARCH_ENABLED=false` | on | — |
| **Multi-agent research** | `MULTI_AGENT_RESEARCH_ENABLED=false` | on | Falls to single sequential agent |
| **Research web access** | `RESEARCH_WEB_ENABLED=false` | on | Research continues on internal data |
| **Library / marketplace** | `LIBRARY_ENABLED=false` | on | Whole library hidden |
| **Library installs** | `LIBRARY_INSTALLATION_ENABLED=false` | on | Discovery works, installs blocked |
| **Public library items** | `PUBLIC_LIBRARY_ENABLED` unset/false | **off** | Public items not surfaced |
| **Suspend one item** | `LIBRARY_SUSPENDED_ITEMS="<slug>"` | — | Item suspended platform-wide |
| **Enterprise surfaces** | `ENTERPRISE_FEATURES_ENABLED=false` | on | — |
| **SSO/SAML** | `SAML_ENABLED` unset/false | **off** | — |
| **SCIM** | `SCIM_ENABLED` unset/false | **off** | — |
| **Sovereign lockdown** | `SOVEREIGN_MODE_ENABLED=true` | off | External AI/web/connectors off unless a profile re-allows |

**DB-backed switches** (Admin UI, no restart): `ai_settings.maintenanceMode`
(all AI off), per-provider `maintenanceMode`, per-model `maintenanceMode`,
budget hard limit (Section: `COST_CONTROL_RUNBOOK.md`).

**Verify** each: exercise the feature and confirm it is refused/degraded as
intended, and that unaffected features still work.

---

## 9. Maintenance mode

**AI maintenance** — Admin → AI control sets `ai_settings.maintenanceMode=true`.
`selectRoute` throws `AI is in maintenance mode`; users see a generic 503; the
admin control plane stays reachable. Verify by sending a chat (should 503) and
loading Admin (should load). Clear the flag to restore.

**Full-platform maintenance** — **REQUIRES INFRA**: put the LB/CDN into a
maintenance page, or scale the web tier to a static holding response. The app has
no single "site down" flag; use the LB. Keep `/api/health` reachable for probes.

---

## Cross-references
- Providers → `AI_PROVIDER_RUNBOOK.md` · Billing → `BILLING_RUNBOOK.md`
- Connectors → `CONNECTOR_RUNBOOK.md` · Workflows → `WORKFLOW_RUNBOOK.md`
- Security → `SECURITY_RUNBOOK.md` · Cost → `COST_CONTROL_RUNBOOK.md`
- Backup/restore → `BACKUP_RESTORE_RUNBOOK.md` · Architecture → `PRODUCTION_ARCHITECTURE.md`
- DR → `DISASTER_RECOVERY.md` · Incidents → `INCIDENT_RESPONSE.md`
