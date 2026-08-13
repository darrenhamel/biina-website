# BIINA.ai — Production Architecture

The production topology for the `apps/web` product app, and how each layer maps to
what is actually built today. **BIINA.ai is the product; LLMs are infrastructure
underneath it** — the frontend never knows which model answered.

> Status legend: **IMPLEMENTED** = in code today · **ARCH READY** = designed and
> code-supported, needs configuration · **REQUIRES INFRA** = needs infrastructure
> or a human decision not present in this repo.

---

## Request path (shared SaaS)

```
                                  Internet (users)
                                        │
                                        ▼
                          ┌──────────────────────────┐
                          │  DNS / CDN / WAF          │  REQUIRES INFRA
                          │  TLS termination at edge  │  (HSTS assumes this)
                          └──────────────┬───────────┘
                                         ▼
                          ┌──────────────────────────┐
                          │  Load Balancer            │  REQUIRES INFRA
                          └──────────────┬───────────┘
                                         ▼
                 ┌───────────────────────────────────────────┐
                 │  Web / API tier — Next.js 14 (App Router)  │  IMPLEMENTED
                 │  • middleware: locale, auth gate,          │
                 │    CSRF same-origin, security headers/CSP  │
                 │  • /api/*: auth, Zod, rate-limit (memory)  │
                 │  • startup: assertProductionReady()        │
                 └───┬───────┬────────┬────────┬─────────┬────┘
                     │       │        │        │         │
          ┌──────────▼─┐  ┌──▼─────┐ ┌▼───────┐│    ┌────▼──────────┐
          │ PostgreSQL │  │ Object │ │ Vector ││    │ AI Gateway    │ IMPLEMENTED
          │ (Drizzle)  │  │ storage│ │ store  ││    │ (server-side  │
          │ IMPLEMENTED│  │ local  │ │ jsonb+ ││    │  provider     │
          │ (managed = │  │ today  │ │ cosine ││    │  abstraction) │
          │  REQ INFRA)│  │ REQ    │ │ IMPL.  ││    └────┬──────────┘
          └────────────┘  │ INFRA  │ └────────┘│         │
                          │ (S3/R2 │           │         ▼
                          │ reserv)│      ┌────▼────┐  ┌───────────────────────┐
                          └────────┘      │ Cache?  │  │ Approved providers:   │
                                          │ REQ     │  │ Ollama / vLLM (self-  │
          ┌────────────────────────────┐  │ INFRA   │  │ hosted) · OpenAI-     │
          │ Worker / Scheduler         │  │ (multi- │  │ compatible · search · │
          │ POST /api/internal/        │  │ instance│  │ connector providers   │
          │   workflows/tick (cron)    │  │ rate-   │  │ REQUIRES INFRA / keys │
          │ DB-authoritative           │  │ limit)  │  └───────────────────────┘
          │ IMPLEMENTED (cron=REQ INFRA)│ └─────────┘
          └────────────────────────────┘
                          │
                          ▼
                 ┌────────────────────┐
                 │ Stripe (billing)   │  IMPLEMENTED (test mode until live)
                 │ webhooks → /api/   │
                 │ billing/webhooks   │
                 └────────────────────┘
```

---

## Layer-by-layer status

| Layer | What it is | Status | Notes |
|---|---|---|---|
| DNS / CDN / WAF | Edge routing, caching, TLS termination | **REQUIRES INFRA** | HSTS is emitted in prod on the assumption TLS terminates at the edge (`middleware.ts`). |
| Load balancer | Distributes to web/API instances | **REQUIRES INFRA** | Needed for HA/multi-instance. |
| Web / API tier | Next.js 14 App Router (`apps/web`) | **IMPLEMENTED** | Middleware: locale prefix, cookie auth gate, CSRF same-origin on mutating `/api`, security headers + CSP (self + Stripe), `CSP_DISABLED` escape hatch. `assertProductionReady()` fails start on CRITICAL config. |
| Auth | Session-cookie auth, server-side validation | **IMPLEMENTED** | Middleware does a cheap cookie check; authoritative validation is server-side (`getCurrentUser`). `AUTH_SECRET` CRITICAL. |
| Rate limiting | Per-process in-memory | **IMPLEMENTED (single-instance)** | `test/rate-limit.test.ts`. **Multi-instance needs a shared DB/cache-backed limiter** — REQUIRES INFRA. |
| PostgreSQL | Primary datastore (Drizzle, migrations 0000–0015) | **IMPLEMENTED** (managed DB = REQUIRES INFRA) | Health probe `select 1` in `/api/health`. |
| Object storage | Uploaded files | **IMPLEMENTED, not durable** | `LocalFileStorage` today; S3/R2 slots reserved. Local disk lost with host → REQUIRES INFRA for production. |
| Vector store | RAG embeddings | **IMPLEMENTED** | `PortableVectorStore` (jsonb + cosine in Postgres); pgvector reserved. Vectors **rebuildable from source docs**. |
| Cache | Shared cache for sessions/rate-limit/queues | **REQUIRES INFRA** | Not present; needed for multi-instance rate limiting and future queueing. |
| Worker / scheduler | Workflow execution | **IMPLEMENTED** (cron = REQUIRES INFRA) | DB-authoritative; external cron calls `POST /api/internal/workflows/tick` with `WORKFLOW_TICK_SECRET`. Duplicate-safe via unique run keys. |
| AI gateway | Provider abstraction (`packages/ai-gateway`) | **IMPLEMENTED** | Server-side only. Routing (`server/ai/routing.ts`) picks model/provider; policy-respecting fallback; no silent prohibited fallback. |
| AI providers | Ollama / vLLM / OpenAI-compatible | **ARCH READY / REQUIRES INFRA** | Self-hosted inference needs GPU hosts (`VLLM_DEPLOYMENT.md`, `RUNPOD_SETUP.md`). Keys/base URLs server-side only. |
| Search / connectors | Web search + OAuth connectors | **IMPLEMENTED (needs provider keys)** | Connector creds AES-256-GCM encrypted. |
| Billing | Stripe | **IMPLEMENTED (test mode)** | Signed + idempotent webhooks; live keys require human approval. |
| Email | Transactional email | **ARCH READY** | `RESEND_API_KEY` (MEDIUM). |

---

## Private / UAE-sovereign deployment differences

A sovereign tenant runs a deployment profile (seeded `uae-sovereign`) with a hard,
conservative posture. Key differences from shared SaaS:

| Aspect | Shared SaaS | Private / UAE Sovereign |
|---|---|---|
| External AI | allowed | **blocked** (`externalAIAllowed:false`); only in-region private providers |
| Web search / connectors | allowed | **blocked** (`externalWebSearchAllowed:false`, `externalConnectorsAllowed:false`) |
| Provider region | any | pinned (`allowedProviderRegions:['UAE']`) — routing enforces residency |
| AI inference | managed/hosted | **self-hosted** Ollama/vLLM in-region (REQUIRES INFRA) |
| Storage / vectors | shared backend | `privateStorageRequired`, `privateVectorStoreRequired` — private, in-region |
| Master lockdown | off | `SOVEREIGN_MODE_ENABLED=true` disables external AI/web/connectors unless a profile re-allows |
| Fallback | may fall over to another compliant provider | **never** to a prohibited/out-of-region provider — a compliance failure returns `NO_COMPLIANT_MODEL_AVAILABLE`, not an external answer |
| Tenant isolation | shared | org-owned providers usable only by the owning org (`satisfiesEnterprisePolicy`) |

See `docs/SOVEREIGN_DEPLOYMENT.md`, `docs/PRIVATE_DEPLOYMENT.md`,
`docs/PRIVATE_MODELS.md`, `docs/UAE_DEPLOYMENT_READINESS.md`,
`docs/DATA_RESIDENCY.md`.

---

## Cross-references
- `OPERATIONS_RUNBOOK.md` · `DISASTER_RECOVERY.md` · `OBSERVABILITY.md`
- `docs/ARCHITECTURE.md` (target architecture, source of truth) · `docs/DEPLOYMENT.md`
