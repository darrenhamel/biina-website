# BIINA.ai — Production Infrastructure Checklist (Phase 18)

Everything that must exist **outside the codebase** before BIINA.ai serves real users.
The application is built and passes its build/tests, but **no production infrastructure
is provisioned**. Almost every item below is `REQUIRES INFRASTRUCTURE` (someone must
provision it) or `REQUIRES HUMAN ACTION` (a deliberate configuration/approval step).

> **Honest posture.** Completing this checklist stands up a working deployment. It does
> **not** by itself constitute any certification, compliance, or sovereignty claim. The
> recommended launch tier is a **controlled, invite-only beta**, not general availability.

Status legend:
- **IMPLEMENTED** — done in code, no infra required.
- **CONFIGURED** — implemented and switched on via environment/config.
- **REQUIRES INFRASTRUCTURE** — a resource must be provisioned/paid for by a human.
- **REQUIRES HUMAN ACTION** — a deliberate decision, approval, or manual step.

Companions:
[`PRODUCTION_ARCHITECTURE.md`](./PRODUCTION_ARCHITECTURE.md),
[`DEPLOYMENT.md`](./DEPLOYMENT.md),
[`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md),
[`OBSERVABILITY.md`](./OBSERVABILITY.md),
[`LOAD_TESTING.md`](./LOAD_TESTING.md),
[`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md),
[`INFRASTRUCTURE_COST_MODEL.md`](./INFRASTRUCTURE_COST_MODEL.md).

---

## 1. Edge & network

### DNS
- ☐ **REQUIRES HUMAN ACTION** — Register/point `biina.ai` (marketing) and `app.biina.ai`
  (product) at the chosen hosts. Set `NEXT_PUBLIC_APP_URL=https://app.biina.ai`.
- **Needed:** apex + `app` records, a mail/SPF/DKIM/DMARC record if sending email from the
  domain, and a CAA record if the TLS issuer is fixed.

### TLS
- ☐ **REQUIRES INFRASTRUCTURE** — Valid certificate for every hostname; HTTPS enforced.
- **Needed:** managed certs (host-provided or ACME). The config validator **rejects** a
  non-`https://` `NEXT_PUBLIC_APP_URL` in production; HSTS is already emitted in middleware.

### CDN / WAF
- ☐ **REQUIRES INFRASTRUCTURE** — CDN for static assets + a WAF in front of the app.
- **Needed:** edge caching for the marketing site and Next.js static output; WAF rules for
  common web attacks and basic bot/rate abuse. Security headers + CSP are already set in
  middleware (`CSP_DISABLED` must remain unset/false in production).

---

## 2. Compute

### Application hosting (Next.js `apps/web`)
- ☐ **REQUIRES INFRASTRUCTURE** — Host the App Router server (Node 20+ runtime).
- **Needed:** a container/host that runs `npm run build` output, injects secrets from a
  manager, and runs the startup config validator (fails safe on missing/weak critical
  config). Health probe: `GET /api/health`.

### Worker hosting (background jobs)
- ☐ **REQUIRES INFRASTRUCTURE** — Currently the scheduler/worker runs **IN-PROCESS**.
- **Needed for scale:** a separate worker process/host that calls the workflow tick
  endpoint (`WORKFLOW_TICK_SECRET`, constant-time, DB-authoritative — no in-memory timers).
  In-process is acceptable **only** for a low-volume beta; see Scale triggers. See
  [`SCHEDULER.md`](./SCHEDULER.md).

### Scheduler
- ☐ **REQUIRES HUMAN ACTION** — A reliable clock source to hit the tick endpoint on an
  interval (host cron, platform scheduler, or the in-process ticker for beta).
- **Note:** the database is the authoritative scheduler; the ticker only wakes it. Missed
  ticks catch up conservatively.

---

## 3. Data

### Database — managed Postgres
- ☐ **REQUIRES INFRASTRUCTURE** — Managed PostgreSQL 16, private networking, TLS.
- **Needed:** `DATABASE_URL` pointing at a managed instance (the validator **rejects**
  `localhost`/`127.0.0.1` in production). Apply migrations `0000`–`0015`. Right-size a
  connection pool for the app + worker concurrency.

### Database backup
- ☐ **REQUIRES INFRASTRUCTURE / REQUIRES HUMAN ACTION** — Automated backups **and a tested
  restore**. No backup has been tested yet.
- **Needed:** point-in-time recovery or scheduled snapshots, an off-region copy, and at
  least one **verified** restore drill before launch. See [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md).

### Object storage
- ☐ **REQUIRES INFRASTRUCTURE** — Durable blob storage for uploaded files/media.
- **Needed:** an S3/R2 bucket + credentials; set `STORAGE_PROVIDER=s3|r2`. Current default
  is **LocalFileStorage**, which the validator flags as **not durable** in production. Files
  are stored opaque and served only as download attachments. See [`FILES.md`](./FILES.md).

### Vector store
- ☐ **REQUIRES HUMAN ACTION (beta) / REQUIRES INFRASTRUCTURE (scale)** — Vector storage for
  RAG + memory.
- **Needed:** the shipped **PortableVectorStore** (jsonb + cosine) runs on the same Postgres
  and is **rebuildable from source documents** — acceptable for beta. For scale, provision
  `pgvector` (reserved) behind the same interface. See [`VECTOR_STORAGE.md`](./VECTOR_STORAGE.md).

---

## 4. AI

### AI inference endpoint
- ☐ **REQUIRES INFRASTRUCTURE** — A real inference endpoint; **`mock` is dev-only and the
  validator refuses it in production**.
- **Needed:** set `AI_DEFAULT_PROVIDER` to `openai-compatible` (vLLM/RunPod-ready) or
  `ollama`, with base URL + model + optional key as server-side env. See
  [`VLLM_DEPLOYMENT.md`](./VLLM_DEPLOYMENT.md), [`RUNPOD_SETUP.md`](./RUNPOD_SETUP.md).

### Embedding endpoint
- ☐ **REQUIRES INFRASTRUCTURE / REQUIRES HUMAN ACTION** — Embeddings for RAG, web grounding,
  and memory.
- **Needed:** a real embedding provider for production quality. A deterministic lexical dev
  embedder ships and lets the pipeline run offline; production configures a real embedder
  behind the same interface. Re-embedding rebuilds the vector store. See [`EMBEDDINGS.md`](./EMBEDDINGS.md).

---

## 5. Platform services

### Email service
- ☐ **REQUIRES INFRASTRUCTURE / REQUIRES HUMAN ACTION** — Transactional email for
  verification, password reset, invitations, notifications.
- **Needed:** a provider (email is provider-configurable; `RESEND_API_KEY` is a supported
  option) plus verified domain + SPF/DKIM/DMARC. Without it, verification/reset flows cannot
  deliver.

### Billing (Stripe live)
- ☐ **REQUIRES HUMAN ACTION** — Billing runs in **Stripe TEST mode**; live is not activated.
- **Needed:** complete [`PRODUCTION_BILLING_CHECKLIST.md`](./PRODUCTION_BILLING_CHECKLIST.md)
  and [`STRIPE_SETUP.md`](./STRIPE_SETUP.md): live keys (`STRIPE_SECRET_KEY` /
  `STRIPE_WEBHOOK_SECRET`), live products/prices, verified webhook endpoint, and the two
  safety flags flipped **only** after approval. Do not enable live charges before legal
  review of subscription/refund terms.

### Monitoring
- ☐ **REQUIRES INFRASTRUCTURE** — Uptime, latency, error-rate, and cost/usage dashboards +
  alerting.
- **Needed:** external uptime checks on `/api/health`, request/latency metrics, an
  error-tracking sink, and cost alarms tied to AI spend. See [`OBSERVABILITY.md`](./OBSERVABILITY.md).

### Logging
- ☐ **REQUIRES INFRASTRUCTURE / REQUIRES HUMAN ACTION** — Centralized log aggregation.
- **Needed:** ship app/worker logs to a retained sink. Logs are already secret-redacted
  (`REDACT_KEYS`); confirm no provider URLs/keys appear. Set retention to your policy.

### Secrets manager
- ☐ **REQUIRES INFRASTRUCTURE / REQUIRES HUMAN ACTION** — Out-of-band secret storage.
- **Needed:** a manager/vault holding `DATABASE_URL`, `AUTH_SECRET`,
  `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, AI
  provider URLs/keys, and email keys. **Never commit real values**; the startup validator
  checks presence/shape (never the value). Enterprise identity + private providers store
  only secret **reference names** in the DB.

---

## Minimum Viable Production (invite-only beta)

Smallest footprint that is honest and safe for a **low-volume, invite-only beta**. This is a
controlled tier, not GA.

- ☐ DNS + managed TLS on `app.biina.ai`; CDN optional, **WAF recommended even for beta**.
- ☐ **One** application host (in-process worker + in-process scheduler acceptable at low
  volume).
- ☐ **Managed** Postgres 16 with automated backups and **one tested restore**.
- ☐ Vector store = shipped PortableVectorStore on the same Postgres (rebuildable) — defer
  `pgvector`.
- ☐ Object storage on S3/R2 (do **not** ship LocalFileStorage to production).
- ☐ One real AI inference endpoint + one real embedding endpoint (no `mock`).
- ☐ Email provider with a verified domain.
- ☐ Billing **left in test mode** unless paid beta is explicitly approved + legally reviewed.
- ☐ Basic monitoring (uptime + errors + AI cost alarm) and centralized logs.
- ☐ Secrets in a manager; config validator passing; conservative feature flags (see
  [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md)).

Everything not listed here (dedicated worker fleet, `pgvector`, CDN edge caching, WAF tuning,
multi-region) is deferred until a Scale trigger fires.

---

## Scale triggers (provisional thresholds)

Move off the beta footprint when any of these fire. **Thresholds are provisional** — confirm
against real load with [`LOAD_TESTING.md`](./LOAD_TESTING.md).

| Signal | Provisional trigger | Action |
|---|---|---|
| **DB connection pressure** | Pool utilization sustained > ~70–80%, or connection wait/timeouts appear | Add a pooler (e.g. PgBouncer), raise instance size, split read replicas |
| **AI concurrency** | Inference queueing / TTFT rising, provider 429/503, concurrency near endpoint limit | Add inference capacity/replicas; tune per-plan concurrency caps |
| **Queue backlog** | Workflow/agent runs waiting past their due time, tick lag growing | Move worker out-of-process; add worker replicas |
| **Vector latency** | RAG/memory retrieval latency dominates response time as corpus grows | Migrate PortableVectorStore → `pgvector` (or dedicated vector DB) |
| **Storage size** | Object storage or DB approaching plan/instance limits; backup windows lengthening | Grow storage tier; lifecycle-archive old media; scale DB |
| **Rate-limit accuracy** | Multiple app instances (rate limiting is **process-local memory** today) | Move to a shared store (e.g. Redis) so limits are global, not per-instance |

> **Known single-instance assumptions to retire at scale:** in-process scheduler/worker and
> **process-local memory** rate limiting are correct only while there is effectively one app
> instance. Horizontal scaling requires an external scheduler/worker and a shared rate-limit
> store first.
