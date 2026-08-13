# Staging Deployment — BIINA.ai

How to stand up a **staging** environment that mirrors production but is **fully
isolated**. Staging exists to rehearse the cutover, run the end-to-end journeys, and
load-test **without any risk to production data or real spend**.

> **Golden rule:** staging shares **nothing** with production — separate database,
> separate object storage, separate secrets, separate callback URLs, TEST billing, and a
> non-production (or tightly controlled) AI endpoint. **Never point staging at production
> customer data.**

Related: [`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md) ·
[`GO_LIVE_RUNBOOK.md`](./GO_LIVE_RUNBOOK.md) ·
[`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md) ·
[`LAUNCH_TEST_MATRIX.md`](./LAUNCH_TEST_MATRIX.md) ·
[`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md)

---

## 0. What "isolated" means (checklist)

- [ ] **Database** — a separate managed Postgres instance/database (e.g. `biina_staging`),
      never the production `DATABASE_URL`.
- [ ] **Object storage** — a separate bucket/prefix; staging writes never touch production media.
- [ ] **Secrets** — `AUTH_SECRET`, `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, tick secret, etc.
      are **staging-only values**, distinct from production's.
- [ ] **Callback / public URLs** — `NEXT_PUBLIC_APP_URL=https://<staging-host>`; OAuth and
      Stripe webhook callbacks point at the staging host only.
- [ ] **Billing** — `BILLING_LIVE_MODE=false` with **Stripe TEST** keys and TEST webhooks.
- [ ] **AI endpoint** — a non-production or tightly controlled endpoint; **or** `mock`
      strictly for load tests (see §7).
- [ ] `BIINA_ENV=staging` so logs/metrics are attributable to staging.

---

## 1. Provision infrastructure — REQUIRES INFRASTRUCTURE

Stand up the same box types as [`MINIMUM_PRODUCTION_TOPOLOGY.md`](./MINIMUM_PRODUCTION_TOPOLOGY.md),
sized down:

1. **App host** capable of running the production container image (the repo `Dockerfile`,
   Next.js `output: 'standalone'`, non-root user `biina`, port `3000`).
2. **Managed Postgres** (with `pgvector` if the vector store will use it) — a fresh, empty
   `biina_staging` database.
3. **Object storage** — a separate staging bucket (S3/R2). `<staging-bucket>`.
4. **Worker/scheduler caller** — an external cron/worker able to `POST` the workflow tick
   (see §5, step 5). Without it, scheduled workflows silently do not run.
5. **AI inference endpoint** — a staging model endpoint reachable from the app host
   (`<staging-inference-url>`), **or** plan to use `mock` for load tests only.

---

## 2. Configure `.env.staging` from the template

Copy [`../.env.staging.example`](../.env.staging.example) to your out-of-band secret
store (do **not** commit a real `.env.staging`). Fill every `__placeholder__` with
**staging-only** values:

| Key | Staging value |
|---|---|
| `BIINA_ENV` | `staging` |
| `NEXT_PUBLIC_APP_URL` | `https://<staging-host>` |
| `DATABASE_URL` | the **staging** Postgres URL (`sslmode=require`) |
| `AUTH_SECRET` / `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` | fresh 32+ char staging secrets |
| `FILE_STORAGE_PROVIDER` + bucket creds | staging bucket (out-of-band) |
| `VECTOR_STORE` | `pgvector` (or the portable default) |
| `AI_DEFAULT_PROVIDER` | staging `openai-compatible`/`ollama` endpoint (or `mock` for load tests) |
| `RESEND_API_KEY` / `SMTP_URL` | a **staging/test** sender |
| `BILLING_ENABLED` / `BILLING_LIVE_MODE` | `true` / `false` (TEST) |
| `WORKFLOW_TICK_SECRET` | a **staging** shared secret for the cron worker |

Feature flags should **mirror the intended launch matrix** (see
[`V1_FEATURE_FLAGS.md`](./V1_FEATURE_FLAGS.md)) so staging tests what production will run.

---

## 3. Validate configuration before deploying

```bash
npm run validate:production -w apps/web
```

`validate-production.ts` prints **OK / WARNING / BLOCKER** per launch concern and **never
prints a secret value**; it exits non-zero if any BLOCKER remains. Resolve every BLOCKER.
Expected staging notes:

- If you use a **real** staging AI endpoint, `AI_DEFAULT_PROVIDER` should be `OK`.
- If you deliberately use `mock` for load tests, the validator marks it a **BLOCKER**
  (mock cannot serve real users) — that is expected; see §7 for the load-test exception.

---

## 4. Migrate the (empty) staging database

```bash
npm run db:migrate -w apps/web    # applies 0000 → 0015 in order
```

See [`PRODUCTION_DATABASE_VALIDATION.md`](./PRODUCTION_DATABASE_VALIDATION.md) for the
from-scratch migration validation procedure (ordering, additive-only, no dev seed data).

---

## 5. Seed production-safe system data + deploy

5. **Seed** plans + deployment profiles **only** (no test users, no mock providers, no
   test billing):

   ```bash
   npm run db:seed:production -w apps/web
   ```

   The seed **refuses** to run against `localhost`/`127.0.0.1` unless
   `ALLOW_LOCAL_PROD_SEED=true`, and refuses if `validate-production` reports critical
   config problems.

6. **Deploy the app (Docker)** using the production image:

   ```bash
   docker build -t biina-web:staging .
   docker run -d --env-file <staging-env> -p 3000:3000 biina-web:staging
   ```

   (Substitute your platform's deploy mechanism; the image and entrypoint are identical to
   production — that is the point of staging.)

7. **Deploy the scheduler tick caller.** Configure an external cron/worker to call, e.g.
   once per minute:

   ```bash
   curl -fsS -X POST https://<staging-host>/api/internal/workflows/tick \
     -H "x-workflow-tick-secret: <staging-tick-secret>"
   ```

   Without a configured `WORKFLOW_TICK_SECRET` **and** an external caller, the endpoint is
   disabled (`503`) and **scheduled workflows silently do not run**.

---

## 6. Bootstrap the first admin + smoke test

1. **Sign up** a real staging user through the app UI.
2. **Promote** that user to platform admin (no hard-coded credentials):

   ```bash
   BOOTSTRAP_ADMIN_EMAIL=<staging-admin-email> npm run bootstrap:admin -w apps/web
   ```

3. **Smoke test**:
   - `GET https://<staging-host>/api/health` → `200 { status: "ok" }` (app + db + config).
   - Admin `GET /api/admin/production-readiness` → detailed readiness (admin session required).

---

## 7. Run the staging journeys (end-to-end)

Execute the full user journeys and record pass/fail in
[`LAUNCH_TEST_MATRIX.md`](./LAUNCH_TEST_MATRIX.md) (these are the rows currently marked
**PENDING-STAGING**):

- [ ] **Core chat journey:** signup → login → chat → **streaming** response →
      **persistence** (reload shows history) → **file** upload → **RAG** retrieval →
      **citation** rendered → **memory** recall → **settings** change → **logout**.
- [ ] **Paid journey (TEST billing):** upgrade via Stripe **TEST** checkout → entitlement
      applies → webhook processed (signature-verified, idempotent) → downgrade/cancel.
      See [`BILLING_RUNBOOK.md`](./BILLING_RUNBOOK.md).
- [ ] **Organization journey:** create org → invite member → member joins → org-scoped
      resources isolated from other tenants.
- [ ] **Scheduled workflow:** create a scheduled workflow → confirm the external tick
      advances it (proves the worker boundary is wired).

### Load-test exception (avoid real AI spend)

For **load tests only**, staging **may** set:

```
AI_DEFAULT_PROVIDER=mock
ALLOW_DEV_FEATURES_IN_PROD=true
```

This exercises the full request/streaming/persistence path **without real inference
spend**. Do this **only** in staging, and switch back to a real endpoint before any test
that must validate real model behavior. See [`LOAD_TESTING.md`](./LOAD_TESTING.md).

---

## Exit criteria

Staging is "green" when: `validate:production` has no BLOCKERs (with a real endpoint),
migrations apply cleanly, the production seed ran, health is `200`, and every journey in
§7 passes. Carry those results into [`PRODUCTION_CUTOVER.md`](./PRODUCTION_CUTOVER.md).
