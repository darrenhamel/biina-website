# BIINA.ai

Monorepo for **BIINA.ai** — an Arabic-first AI platform. BIINA is the product;
individual AI models are infrastructure underneath it, reached through the BIINA
AI Gateway so the app is never coupled to one vendor.

> New here? Read [`CLAUDE.md`](./CLAUDE.md) and [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## What's in the monorepo (npm workspaces)

```
apps/marketing/       Astro static marketing site (biina.ai)              — finished
apps/web/             Next.js full-stack product app (app.biina.ai)       — Phase 1
packages/ai-gateway/  Provider abstraction (server-side only)             — mock in Phase 1
docs/                 ARCHITECTURE · ROADMAP · DEPLOYMENT
```

## Tech stack (apps/web)

Next.js 14 (App Router) · TypeScript · React · Tailwind CSS · PostgreSQL ·
**Drizzle ORM** · custom server-side session auth · bilingual EN/AR with full RTL.

> Why Drizzle over Prisma: it generates SQL migrations and type-checks fully
> **offline** (no engine-binary download), which keeps CI/local checks reliable.

## Prerequisites

- **Node.js 20+** and npm 10+
- **Docker** + Docker Compose (for local Postgres)

## Quick start

```bash
# 1. Install all workspaces
npm install

# 2. Configure environment
cp .env.example .env        # defaults match the docker-compose Postgres

# 3. Start the database
docker compose up -d        # Postgres on :5432

# 4. Create the schema (applies generated SQL migrations)
npm run db:migrate          # or: npm run db:push   (dev, no migration files)

# 5. (optional) Seed an admin + test user
npm run db:seed

# 6. Run the product app
npm run dev                 # http://localhost:3000
```

The marketing site is independent:

```bash
npm run dev:marketing       # http://localhost:4321
```

## Common commands (run from repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Start the product app (`apps/web`) on :3000 |
| `npm run dev:marketing` | Start the Astro marketing site on :4321 |
| `npm run build` | Production build of the product app |
| `npm run lint` | ESLint (`apps/web`) |
| `npm run typecheck` | TypeScript, no emit (`apps/web`) |
| `npm run test` | Unit tests (Vitest) |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema (offline) |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:push` | Push schema directly (dev convenience) |
| `npm run db:seed` | Insert development seed data |

## Environment variables

See [`.env.example`](./.env.example) for the complete, commented list. The
essentials for Phase 1:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | Session signing secret (generate a long random value) |
| `AI_DEFAULT_PROVIDER` | `mock` (default), `ollama`, or `openai-compatible` |
| `AI_DEFAULT_MODEL` | Optional logical model id; auto-selected if unset |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Ollama endpoint + model tag (Phase 2) |
| `OLLAMA_REQUEST_TIMEOUT_MS` | Ollama per-request timeout (default 120000) |
| `OPENAI_COMPATIBLE_BASE_URL` | Remote vLLM/OpenAI-compatible endpoint (Phase 3) |
| `OPENAI_COMPATIBLE_API_KEY` | Bearer key, server-side only (optional) |
| `OPENAI_COMPATIBLE_MODEL` | Served model name (hidden from the UI) |
| `AI_FALLBACK_ENABLED` / `AI_FALLBACK_MODEL` | Optional fallback (off by default) |

**Secrets are server-side only and never logged.** Real `.env*` files are
git-ignored; keep them out of version control.

## Health check

```bash
# Public, lean — component status only:
curl http://localhost:3000/api/health
# { "status": "ok", "checks": { "app": "ok", "database": "ok", "aiGateway": "ok" }, "ai": { "provider": "..." } }

# Admin-only AI diagnostics (requires an ADMIN session cookie):
curl http://localhost:3000/api/ai/health
# { "provider": "ollama", "providerConnection": "ok", "configuredModel": "ok", "availableModels": [ ... ] }
```

## Local AI development (Ollama)

BIINA talks to local models through the **BIINA AI Gateway** → **OllamaProvider**.
The browser never talks to Ollama; everything is server-side. Out of the box the
app runs on the built-in `mock` provider (no setup). To use real local models:

**1. Install Ollama** (one-time, do this yourself — we don't auto-install system software):

```bash
# macOS / Linux — official installer:
curl -fsSL https://ollama.com/install.sh | sh
# or on macOS: brew install ollama   •   see https://ollama.com/download
```

**2. Start Ollama** (it listens on `http://localhost:11434`):

```bash
ollama serve        # or launch the Ollama app; `ollama --version` to verify
```

**3. Pull a small development model** (don't pull huge models for dev):

```bash
ollama pull llama3.2:3b     # ~2 GB, good default. Alternatives: qwen2.5:1.5b, phi3:mini
ollama list                 # see installed models
```

**4. Point BIINA at Ollama** in `.env`:

```bash
AI_DEFAULT_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b          # must match a model you pulled
OLLAMA_REQUEST_TIMEOUT_MS=120000
```

**5. Start BIINA and verify:**

```bash
npm run dev                        # http://localhost:3000
curl http://localhost:3000/api/health          # aiGateway: ok, provider: ollama
# As an ADMIN, GET /api/ai/health confirms Ollama reachability + that OLLAMA_MODEL exists.
```

**6. Test AI chat:** open the app, start a new chat, and send a message — the reply
streams token-by-token. **Stop** cancels generation immediately (propagated to Ollama).

**7. Change the active local model:** pull it (`ollama pull <model>`), set `OLLAMA_MODEL`
to that tag, and restart. No code or UI change — the model is chosen through the
registry/env, never hard-coded in components.

> The consumer UI never shows "Ollama" — the model provider is infrastructure.

## Cloud AI (OpenAI-compatible: vLLM / RunPod)

For production, BIINA connects to any **OpenAI-compatible** endpoint (vLLM,
RunPod-hosted vLLM, self-hosted vLLM, …) through the same gateway. **Switching
from local Ollama to cloud inference is configuration only — no code changes.**

Set in the **server** environment (never the browser, never git):

```bash
AI_DEFAULT_PROVIDER=openai-compatible
AI_DEFAULT_MODEL=biina-general
OPENAI_COMPATIBLE_BASE_URL=https://your-endpoint        # root or its /v1 form; both work
OPENAI_COMPATIBLE_API_KEY=your-secret-key               # omit for unauthenticated private endpoints
OPENAI_COMPATIBLE_MODEL=Qwen/Qwen2.5-7B-Instruct        # the infra model; hidden from the UI
OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS=120000             # generous, to ride out serverless cold starts
```

Verify (as an ADMIN): `GET /api/ai/health` →
`provider: openai-compatible · providerConnection: ok · configuredModel: ok`.

- **Deployment:** see [`docs/VLLM_DEPLOYMENT.md`](./docs/VLLM_DEPLOYMENT.md) (model
  sizing, VRAM, quantization, startup flags, cold starts, scaling).
- **RunPod, step by step:** see [`docs/RUNPOD_SETUP.md`](./docs/RUNPOD_SETUP.md).
- **Optional fallback** (disabled by default, never silent, never mid-stream):
  `AI_FALLBACK_ENABLED=true` + `AI_FALLBACK_MODEL=<logical id of a different provider>`.

### Troubleshooting remote inference

| Symptom | Likely cause | Fix |
|---|---|---|
| chat 503 "temporarily unavailable" | endpoint down / cold start / timeout | raise `OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS`; retry |
| `configuredModel: missing` in diagnostics | model name ≠ served name | match `OPENAI_COMPATIBLE_MODEL` to `/v1/models` |
| `invalid_config` / auth failed | wrong/missing API key | re-set `OPENAI_COMPATIBLE_API_KEY` |
| `providerConnection: error` | wrong base URL / unreachable | check URL scheme/host; endpoint must be http(s) |

## Adding another AI provider

The whole point of the gateway is that new providers require **no frontend or DB
change**. To add one (e.g. OpenAI-compatible/vLLM in Phase 3, or OpenAI/Anthropic/
Gemini later):

1. **Implement the adapter** in `packages/ai-gateway/src/providers/<name>.ts` —
   a class implementing the `AIProvider` interface (`chat()` yielding the
   provider-agnostic `ChatChunk` stream, `health()`, optional `discoverModels()`).
   Normalize the vendor payload and map failures to `GatewayError` codes.
2. **Register it** in `packages/ai-gateway/src/registry.ts`: add a `case` in
   `instantiate()` and a `ModelDescriptor` entry in `listModels()` (id, provider,
   `providerModel`, `capabilities`, `enabled`).
3. **Add its env vars** to `.env.example` (keys stay server-side, never logged).
4. **Select it** via `AI_DEFAULT_PROVIDER` / `AI_DEFAULT_MODEL`.

That's it — `/api/ai/chat`, the AI service, and the UI are untouched.

## What is (and isn't) built in Phase 1

**Built (Phase 1):** landing, sign-up/login/logout, sessions + protected routes,
account & settings, the chat interface (streaming, stop, regenerate, copy, empty
state), conversation persistence (create/rename/delete/history), a scalable nav
with feature-disabled areas, persona architecture, admin scaffold, `/api/ai/chat`,
health check, EN/AR + RTL.

**Added (Phase 2):** real **Ollama provider** + provider router in the gateway,
env-driven model registry, normalized streaming, typed error handling
(`GatewayError`), server-side system-prompt composition, request-id logging with
usage metrics, admin AI diagnostics (`/api/ai/health`).

**Added (Phase 3):** real **OpenAI-compatible provider** (vLLM/RunPod-ready) with
SSE streaming, per-provider timeouts, conservative connect retries, cancellation,
full error normalization, latency (TTFT) metrics, and vLLM/RunPod deployment docs.
Local Ollama ↔ cloud vLLM is a **config-only** switch.

**Added (Phase 4):** DB-backed **model routing + admin control plane**. A model
catalog + provider registry (secrets stay in ENV), a routing engine
(default/persona/workload/plan priority, capability gating, DB fallback), an
**Admin → AI Control** page (`/api/admin/ai/*`) to manage models/providers/routing,
a user model selector (BIINA names only), routing/audit logging, and a `plan`
column for future tiers. See [`docs/MODEL_ROUTING.md`](./docs/MODEL_ROUTING.md) and
[`docs/AI_CONTROL_PLANE.md`](./docs/AI_CONTROL_PLANE.md).

**Added (Phase 5):** **usage metering, plans & cost controls** (no payments). A
provider-independent usage ledger (`usage_events`), pre-generation entitlement +
quota + rate/concurrency + hard-budget checks, per-model cost estimation, DB-backed
plans (FREE→ADMIN) with a user **Usage** page and admin **Usage & Cost** + **Plans**
pages. See [`docs/USAGE_METERING.md`](./docs/USAGE_METERING.md),
[`docs/PLANS_AND_ENTITLEMENTS.md`](./docs/PLANS_AND_ENTITLEMENTS.md), and
[`docs/COST_CONTROLS.md`](./docs/COST_CONTROLS.md).

**Added (Phase 6):** **authentication hardening, user management & organizations.**
Central permission service (platform roles USER/ADMIN/SUPER_ADMIN, distinct from
org roles OWNER/ADMIN/MEMBER), rate-limited auth flows, single-use hashed
verify/reset tokens, session management, account status, IDOR-safe multi-tenant
organizations + invitations, provider-independent email, CSRF/HSTS. See
[`docs/AUTHENTICATION.md`](./docs/AUTHENTICATION.md),
[`docs/AUTHORIZATION.md`](./docs/AUTHORIZATION.md),
[`docs/ORGANIZATIONS.md`](./docs/ORGANIZATIONS.md), and
[`docs/SECURITY.md`](./docs/SECURITY.md).

**Added (Phase 7):** **payments, subscriptions & commercial plans (test mode).** A
provider-independent billing abstraction (`BillingService` → `PaymentProvider` →
Stripe), plan-vs-price separation, checkout/portal/cancel/resume, signature-
verified idempotent webhooks, entitlements that follow verified billing state
(driving the unchanged Phase 5 quotas), org billing readiness, and admin revenue /
unit-economics reporting. Two safety flags keep it off by default; live charges
require completing [`docs/PRODUCTION_BILLING_CHECKLIST.md`](./docs/PRODUCTION_BILLING_CHECKLIST.md).
See [`docs/BILLING_ARCHITECTURE.md`](./docs/BILLING_ARCHITECTURE.md),
[`docs/SUBSCRIPTIONS.md`](./docs/SUBSCRIPTIONS.md),
[`docs/COMMERCIAL_PLANS.md`](./docs/COMMERCIAL_PLANS.md),
[`docs/BILLING_SECURITY.md`](./docs/BILLING_SECURITY.md), and
[`docs/STRIPE_SETUP.md`](./docs/STRIPE_SETUP.md).

**Added (Phase 8):** **files, knowledge bases & RAG** — documents-grounded chat.
Server-side file validation + opaque storage (never executed), a knowledge-base
model owned by a user or org (reusing Phase 6 roles), and retrieval that runs
**before** generation with structural tenant isolation (in-query scope filter,
Org A ≠ Org B) and prompt-injection defense (document text is untrusted data, the
LLM never decides access). Portable defaults — a jsonb vector store (no `pgvector`)
and a deterministic lexical dev embedder — run and test the pipeline anywhere;
production configures real embeddings + `pgvector` behind the same interfaces. RAG
is context infrastructure, gated by plan, and never bypasses Phase 4 routing or
Phase 5 quotas. See [`docs/FILES.md`](./docs/FILES.md),
[`docs/KNOWLEDGE_BASES.md`](./docs/KNOWLEDGE_BASES.md),
[`docs/RAG_ARCHITECTURE.md`](./docs/RAG_ARCHITECTURE.md),
[`docs/VECTOR_STORAGE.md`](./docs/VECTOR_STORAGE.md),
[`docs/EMBEDDINGS.md`](./docs/EMBEDDINGS.md), and
[`docs/RAG_SECURITY.md`](./docs/RAG_SECURITY.md).

**Added (Phase 9):** **web search & live grounding** — chat grounded in the live
public web. A user-opt-in pipeline (search → bounded source selection →
SSRF-guarded fetch → extract → ground → cite) where the **LLM never browses
directly** — every fetch passes through BIINA server components with structural
SSRF protection (public addresses only, re-validated on every redirect), and page
content is **untrusted data, not instructions**. The query sent to the search
provider is the user's question only; public web and private knowledge stay
separate with conflicts surfaced. Unified citations across private documents and
web pages (with "Retrieved on [date]"), an answer mode header, and plan-gated
web-search quotas. A deterministic **mock** provider runs and tests the whole
pipeline offline; a real vendor (Brave/Tavily/Bing) is an adapter + env away. Web
search is context infrastructure and never bypasses Phase 4 routing or Phase 5
quotas. See [`docs/WEB_SEARCH.md`](./docs/WEB_SEARCH.md),
[`docs/WEB_GROUNDING.md`](./docs/WEB_GROUNDING.md),
[`docs/WEB_SECURITY.md`](./docs/WEB_SECURITY.md),
[`docs/CITATIONS.md`](./docs/CITATIONS.md), and
[`docs/SEARCH_PROVIDER.md`](./docs/SEARCH_PROVIDER.md).

**Added (Phase 10):** **connectors & external-app integration** — chat grounded in
the user's own Google Drive / Gmail / Calendar / Slack. A centralized OAuth flow
(single-use bound state, PKCE, session-matched callback, explicit redirect URI —
no open redirect) and **AES-256-GCM-encrypted credentials** (server-only,
never logged, key-versioned + KMS-ready). Every external call goes through
`ConnectorService` / `ToolExecutionService`, which run **only allowlisted tools** —
there is **no arbitrary-HTTP/API tool**, so SSRF and exfiltration are removed
structurally, and identity is server-derived. Phase 10 is **read-only**: write
tools are registered and risk-classified but **disabled** (no autonomous actions).
Connections are personal **XOR** org with strict isolation (Org A ≠ Org B), and
connected content is **untrusted data, not instructions** — private, never
web-searched, never cross-tenant. A deterministic **mock** connector runs and tests
the whole connect → search → ground → cite path offline; Google adapters are ready
and activate via [`docs/CONNECTOR_ACTIVATION_CHECKLIST.md`](./docs/CONNECTOR_ACTIVATION_CHECKLIST.md).
Gated by plan + connected-search quotas; never bypasses Phase 4 routing or Phase 5
quotas. See [`docs/CONNECTOR_ARCHITECTURE.md`](./docs/CONNECTOR_ARCHITECTURE.md),
[`docs/OAUTH.md`](./docs/OAUTH.md),
[`docs/CONNECTOR_SECURITY.md`](./docs/CONNECTOR_SECURITY.md),
[`docs/CONNECTED_SEARCH.md`](./docs/CONNECTED_SEARCH.md),
[`docs/GOOGLE_CONNECTORS.md`](./docs/GOOGLE_CONNECTORS.md), and
[`docs/TOOL_EXECUTION.md`](./docs/TOOL_EXECUTION.md).

**Added (Phase 11):** **the agent engine & safe tool execution** — BIINA.ai can now
*plan and act* over the Phase 10 tool allowlist, as a **bounded, human-supervised**
agent, not an autonomous one. The model **proposes** (one JSON decision per turn);
BIINA **authorizes, executes, limits, and audits**. Reads run live; **every
side-effecting write pauses for explicit human approval** with an exact
`ActionPreview` (no secrets). Approvals are single-use, expiring, and **hash-bound**
to the precise arguments — an edit rebinds a new hash — and a central risk taxonomy
(model never sets it) allows reads, requires approval for external communication, and
**denies destructive/financial actions by default**. A policy engine folds Platform →
Org → User (most-restrictive-wins), and there is **no arbitrary-HTTP/API/shell tool**.
Writes run a live gauntlet — kill switches → dry-run → idempotency → live policy →
consume approval → live connection/scope → live entitlement → server-only credential
→ adapter write → **verify provider id** (no id ⇒ unknown outcome, never success) —
with no auto-retry on ambiguous outcomes. Runs are bounded (step/time/cost limits +
loop detection), tenant-isolated (personal XOR org), and audited **metadata-only**
(operational steps, **never chain-of-thought**). Reads run live; **writes run on a
mock adapter by default** — real Gmail/Calendar/Slack writes stay **disabled** until
live write scopes **and** `AGENT_WRITE_ACTIONS_ENABLED=true` and the manual steps in
[`docs/AGENT_ACTIVATION_CHECKLIST.md`](./docs/AGENT_ACTIVATION_CHECKLIST.md). Gated by
`plan.agentEnabled` + per-plan session quotas. See
[`docs/AGENT_ARCHITECTURE.md`](./docs/AGENT_ARCHITECTURE.md),
[`docs/TOOL_POLICY.md`](./docs/TOOL_POLICY.md),
[`docs/ACTION_APPROVALS.md`](./docs/ACTION_APPROVALS.md),
[`docs/AGENT_SECURITY.md`](./docs/AGENT_SECURITY.md),
[`docs/AGENT_EXECUTION.md`](./docs/AGENT_EXECUTION.md), and
[`docs/AGENT_AUDITING.md`](./docs/AGENT_AUDITING.md).

**Added (Phase 12):** **workflows, scheduled automations & reusable agents** —
BIINA.ai can now run an agent **on a schedule**, unattended, **without becoming
autonomous**. A workflow is saved *configuration* (goal + trigger + sources + limits +
approval policy); every run is turned into an ordinary Phase 11 agent run and passes
through the **same** gates, so **scheduling grants no new permissions**. The
**database is the authoritative scheduler** (no in-memory timers): a lightweight
worker calls one shared-secret endpoint (`WORKFLOW_TICK_SECRET`, constant-time,
**no user job payload**, 503 if unset), each due instant is **claimed by a unique run
key** so concurrent workers never double-fire, scheduling is **timezone/DST-correct**
(IANA zones via `Intl`, monthly day-31 clamped), missed runs catch up conservatively,
and stuck runs recover by heartbeat with **no write auto-retry**. Ownership is personal
**XOR** org (org workflows run under the creator with live membership + active-org
re-checks); authority — plan entitlement, quotas, suspension, credentials — is
re-derived **live at every run**. Every external write **still pauses for a human**;
the run persists as awaiting-approval (worker freed, owner notified) and resumes as a
continuation. The **only** unattended write path is a **narrow standing
authorization** — bound to one workflow + tool + connection + an **exact destination
allowlist** + risk ceiling + limits + expiry, whose creation *is* the explicit
approval, consumed atomically and revocable immediately. Real external writes and
**scheduled writes are OFF by default** and need deliberate activation: a scheduled
write requires **both** a standing authorization **and**
`WORKFLOW_SCHEDULED_WRITES_ENABLED=true` (default false) on top of the Phase 11 write
switch. Natural-language setup produces a **DRAFT** via deterministic heuristics
(never executed model JSON); built-in templates are structure-only; notifications are
provider-independent and deduped. See [`docs/WORKFLOWS.md`](./docs/WORKFLOWS.md),
[`docs/SCHEDULER.md`](./docs/SCHEDULER.md),
[`docs/AUTOMATION_SECURITY.md`](./docs/AUTOMATION_SECURITY.md),
[`docs/WORKFLOW_APPROVALS.md`](./docs/WORKFLOW_APPROVALS.md),
[`docs/WORKFLOW_TEMPLATES.md`](./docs/WORKFLOW_TEMPLATES.md), and
[`docs/WORKFLOW_COSTS.md`](./docs/WORKFLOW_COSTS.md).

**Added (Phase 13):** **memory, personalization & the context engine** — BIINA.ai
can now **remember** durable facts and preferences across conversations, and a
**ContextEngine** is the single place that turns memory + explicit personalization
into model context. Memory is a **distinct data category** — separate from
conversation history, knowledge bases, profile settings, and live data — and it is
**consent-gated**: not all conversation is memorized, and **nothing is auto-saved
unless AUTO mode is on and the content is low-risk**. Memory is **background context,
never authority**: it never overrides platform safety, org policy, or your **current
request**, and it **never authorizes an action** (a "usually emails John" memory does
not satisfy an agent approval — a standing authorization still does). Memory enters
two ways: **explicit** "remember / forget" (deterministic, synchronous, full
confidence) and **inferred** candidates drawn **only from your own message text**
(never from tool/web/connected content — the poisoning boundary), surfaced for
approval in **ASK** mode or auto-accepted only when low-risk in **AUTO** mode.
Secrets/credentials and injected instructions are **blocked from every memory path**,
sensitive/restricted content needs explicit consent, and personal **XOR**
organization memory are separate security domains (Org A's memory never appears in
Org B). You keep full control — view, search, edit, delete, clear-all (memory only,
not your account/chats/files), review suggestions, set the mode, or turn memory off;
**temporary chat** uses and creates no durable memory. Memory reuses the existing RAG
embedding provider (no second vector store) and is retrieved with a tight budget
(a few items, capped tokens). Consent lives on your **profile**, not an env var. See
[`docs/MEMORY_ARCHITECTURE.md`](./docs/MEMORY_ARCHITECTURE.md),
[`docs/CONTEXT_ENGINE.md`](./docs/CONTEXT_ENGINE.md),
[`docs/PERSONALIZATION.md`](./docs/PERSONALIZATION.md),
[`docs/MEMORY_PRIVACY.md`](./docs/MEMORY_PRIVACY.md),
[`docs/ORGANIZATION_MEMORY.md`](./docs/ORGANIZATION_MEMORY.md), and
[`docs/MEMORY_SECURITY.md`](./docs/MEMORY_SECURITY.md).

**Added (Phase 14):** **multimodal AI — vision, OCR, audio & voice** — BIINA.ai can now
**understand images and audio** and **speak answers back**. As everywhere else, BIINA is
the **orchestration layer**: every modality goes through a **provider-independent
service** (Vision / OCR / speech-to-text / text-to-speech), never coupled to a single
vendor. The **shipped providers are mock/offline** and deterministic (they power the
tests and demos with no network and no credentials); **real vision / OCR / STT / TTS
providers require configuration and manual activation** — no paid vendor is auto-enabled
and there are **no silent paid calls**. Uploads are validated **server-side** by magic
bytes (the browser's declared type is never trusted), size, and dimensions (with a
decompression-bomb guard); bytes are stored **opaque**, served only as a download
attachment (never inline HTML), and **EXIF/location metadata never leaves the server**.
Text BIINA reads out of an image (OCR) or hears in audio-within-an-image is **untrusted
data** — the same prompt-injection boundary as documents, web, and connected sources — so
a *"SYSTEM: ignore all rules"* image cannot instruct the model; a QR code or URL in an
image is **not auto-fetched**; and media **never authorizes an action** or silently
creates memory. An audio **transcript is your own words** and passes exactly the controls
your typed text does. Media is **tenant-isolated** (personal XOR org) with access
**re-checked on every retrieval** — a known media id is never enough. **Voice mode** is
turn-based (record → transcribe → answer → speak), opt-in, and — critically — **never
bypasses approval**: a spoken high-impact request still stops at the normal approval UI
(no loose spoken "yes"), and a spoken workflow becomes a **draft, not an armed
automation**. Spoken answers use **logical BIINA voices** (English + Arabic) whose
provider ids stay server-side, and synthesized audio is scoped **per user**, never
globally cached. Media metering is a **separate ledger** from AI text tokens (no
double-counting), records **provider-reported units only**, and is gated by per-plan
entitlements and quotas. See
[`docs/MULTIMODAL_ARCHITECTURE.md`](./docs/MULTIMODAL_ARCHITECTURE.md),
[`docs/VISION.md`](./docs/VISION.md), [`docs/OCR.md`](./docs/OCR.md),
[`docs/SPEECH_TO_TEXT.md`](./docs/SPEECH_TO_TEXT.md),
[`docs/TEXT_TO_SPEECH.md`](./docs/TEXT_TO_SPEECH.md),
[`docs/VOICE_MODE.md`](./docs/VOICE_MODE.md),
[`docs/MULTIMODAL_SECURITY.md`](./docs/MULTIMODAL_SECURITY.md),
[`docs/MULTIMODAL_COSTS.md`](./docs/MULTIMODAL_COSTS.md), and
[`docs/MULTIMODAL_ACTIVATION_CHECKLIST.md`](./docs/MULTIMODAL_ACTIVATION_CHECKLIST.md).

**Deferred:** **real external write actions** (the agent ships write-capable but on
the mock adapter; real Gmail/Calendar/Slack writes require manual activation),
**scheduled external writes** (off by default; need a standing authorization **and**
`WORKFLOW_SCHEDULED_WRITES_ENABLED=true`), **event/webhook & connector-event
triggers**, **org service identities**, a **workflow template marketplace**, a
**version-rollback UI**, automatic compensating actions (undo/rollback),
**model-backed memory inference** (a deterministic offline extractor ships; a model
extractor plugs in behind it), **memory consolidation**, **conversation
summarization**, a **memory export UI**, **background memory-expiration cleanup**,
**real vision / OCR / STT / TTS providers** (deterministic mock providers ship; real
vendors plug in behind the same interfaces via configuration), **image
resizing / EXIF-stripping by re-encoding**, **streaming / realtime voice** (barge-in /
interruption) and **speaker diarization**, a **transcript-editing UI**, **signed-URL
media delivery**, a **per-unit media cost service**, the **scanned-PDF → RAG** wiring
(the OCR service + RAG pipeline ship; the page-image-to-ingestion hop is later),
**live provider credentials** (Google/Slack ship on the mock connector), live payment
activation, marketplace/payouts, a live search-provider key, a caching layer for
fetched pages, and the pre-launch audit. See [`docs/ROADMAP.md`](./docs/ROADMAP.md).
