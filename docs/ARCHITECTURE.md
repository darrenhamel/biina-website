# BIINA.ai — Architecture

> Status: **Planning / Phase 0** (this document is the target architecture, not
> yet fully built). The only thing that currently exists in the repository is
> the static marketing site (see [Current state](#0-current-state)).
>
> Naming note: the build prompts spell the product **"Banaii.ai"**. We treat that
> as a spelling variant and brand everything **BIINA.ai**, matching the existing
> marketing site and the `biina-website` repository. If that decision is ever
> reversed, it is a find-and-replace, not an architectural change.

---

## 0. Current state

The repository today is a **single static marketing site**:

- **Astro 4** + TypeScript, output is plain static HTML (`dist/`).
- Bilingual **English + Arabic**, Arabic is **RTL-first** (not a mirror).
- Self-hosted fonts (Manrope + IBM Plex Sans Arabic); **zero third-party requests**.
- Contact form via **Formspree** — no backend, no database.
- Brand tokens live in `src/styles/global.css` (deep navy `#0A1F3D` + one blue accent).
- Copy is data-driven in `src/data/*.ts` and `src/i18n/ui.ts`, EN and AR side by side.

This site is a **credibility site**, deliberately conservative in its claims. It
is finished and deployable. **We keep it.** It is not the product.

## 1. What we are building

BIINA.ai the **product** is a full-stack, multi-tenant AI chat application. The
guiding principle:

> **BIINA.ai is the product. Individual LLMs are infrastructure underneath it.**

The application must never be coupled to one model or one vendor. Everything the
user sees is "BIINA" — the frontend must not know or care which model produced a
response. That decoupling is enforced by the **BIINA AI Gateway** (§4).

## 2. Repository shape — monorepo (npm workspaces)

We convert the repo into an **npm-workspaces monorepo**. Nothing is deleted; the
existing site moves into `apps/marketing/`.

```
biina-website/                     # workspace root
├── apps/
│   ├── marketing/                 # ← existing Astro static site (moved here as-is)
│   │                              #   deploys to biina.ai (root domain)
│   └── web/                       # ← NEW: Next.js full-stack product app
│                                  #   deploys to app.biina.ai
├── packages/
│   └── ai-gateway/                # framework-agnostic TS: provider abstraction,
│                                  #   model registry, streaming, usage metering.
│                                  #   Imported by apps/web server-side only.
├── docs/                          # ARCHITECTURE / ROADMAP / DEPLOYMENT / ...
├── package.json                   # workspace root: { "workspaces": ["apps/*","packages/*"] }
└── CLAUDE.md
```

Why a monorepo (vs. two repos or one merged app):

- The marketing site and the app have **different runtimes** (static vs. Node
  server) and **different deploy targets** — they should not share a build.
- The AI Gateway is genuinely **shared, framework-agnostic logic**. Putting it in
  `packages/ai-gateway` keeps it testable in isolation and reusable if a separate
  backend service is ever split out.
- One repo, one place to reason about brand tokens, i18n conventions, and docs.

Rule of thumb going forward: **static/marketing → `apps/marketing`; anything with
auth, a database, or an AI call → `apps/web` (UI) or `packages/ai-gateway` (logic).**

## 3. `apps/web` — the product application

Recommended stack (chosen for: TypeScript end-to-end, server-side secrets by
default, low cost, Docker-friendly, single deployable unit for the MVP):

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | One deployable for UI + API; Server Components keep AI/DB calls server-side by default. |
| Styling | **Tailwind CSS** + CSS variables reusing the existing brand tokens | Fast, consistent, RTL-friendly with logical properties. |
| Database | **PostgreSQL** | Relational, ubiquitous, cheap, strong Docker story. |
| ORM | **Prisma** | First-class TS types, migrations, good DX. |
| Auth | **Auth.js (NextAuth v5)** — credentials + session, server-side | Server-side sessions, secure http-only cookies, no keys in browser. |
| i18n | **next-intl** (or equivalent), EN + AR, RTL | Message catalogs mirror the marketing site's EN/AR discipline. |
| Validation | **Zod** on every API boundary | One schema = runtime validation + TS types. |

### Layering (strict, one direction)

```
  Browser (React client components — NEVER hold provider keys)
      │  fetch() → same-origin
      ▼
  apps/web  Route Handlers  /api/*        ← auth, Zod validation, rate limit
      │
      ▼
  Services (apps/web/src/server/*)         ← entitlement/metering, conversation store
      │
      ▼
  packages/ai-gateway                      ← provider abstraction, model registry
      │
      ▼
  Provider adapters:  Ollama │ OpenAI-compatible (vLLM/RunPod) │ (later: OpenAI, Anthropic, Gemini)
```

The browser only ever talks to **`/api/*` on the same origin**. Provider base
URLs and API keys exist **only** in server environment variables.

## 4. The BIINA AI Gateway (`packages/ai-gateway`)

The heart of the architecture. A small, framework-agnostic TypeScript package.

**Provider interface (shape, not final code):**

```ts
interface ChatRequest {
  model: string;                 // logical model id from the registry, NOT a vendor default
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  requestId: string;             // correlation id, generated per request
  signal?: AbortSignal;          // enforces timeouts / cancellation
}

interface ChatChunk { delta: string; done: boolean; usage?: UsageMeta; }

interface AIProvider {
  readonly name: 'ollama' | 'openai-compatible' | string;
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;   // streaming-first
  health(): Promise<ProviderHealth>;
}
```

**Standardized, provider-agnostic response** — the frontend sees one shape
regardless of vendor: streamed text deltas plus, when available, `{ model,
provider, inputTokens, outputTokens, totalTokens, latencyMs, requestId, status }`.

**Providers:**
1. **`MockProvider`** — zero-config development stub (`AI_DEFAULT_PROVIDER=mock`).
2. **`OllamaProvider`** ✅ *(Phase 2, implemented)* — local models over Ollama's
   HTTP API (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_REQUEST_TIMEOUT_MS`). Parses
   Ollama's NDJSON stream into the provider-agnostic `ChatChunk` contract; normalizes
   usage (`prompt_eval_count`/`eval_count`/`total_duration`) and errors.
3. **`OpenAICompatibleProvider`** ✅ *(Phase 3, implemented)* — any OpenAI-compatible
   endpoint (vLLM, RunPod-hosted vLLM, self-hosted). SSE `/v1/chat/completions`
   normalized to `ChatChunk`; usage from the final chunk; optional `Bearer` auth
   (`OPENAI_COMPATIBLE_BASE_URL/_API_KEY/_MODEL/_REQUEST_TIMEOUT_MS`). Deliberately
   generic — **RunPod is just a base URL**, no vendor-specific code. Switching
   Ollama ↔ vLLM is config only. See `docs/VLLM_DEPLOYMENT.md` / `docs/RUNPOD_SETUP.md`.

**Later, without any frontend change:** `OpenAIProvider`, `AnthropicProvider`,
`GeminiProvider`, DeepSeek, Qwen — each a new adapter implementing `AIProvider`,
registered in the model registry. See [Adding a provider](#8-adding-a-provider-later).

**Error taxonomy:** providers throw `GatewayError` with a stable `code`
(`provider_unavailable` · `model_unavailable` · `timeout` · `cancelled` ·
`invalid_config` · `bad_response`). The app maps the code to a safe user message
and HTTP status; technical detail is logged server-side only.

**Cross-cutting concerns handled in the gateway/service (not in the UI):**
streaming, per-request timeouts, conservative connect retries (setup-only, never
after streaming has begun — no duplicate generation/cost), provider error
normalization, graceful failure, request & conversation IDs, token/usage
metadata, latency metrics (time-to-first-token + total), structured server-side
logging. The route pulls the first chunk before responding, so connection/model/
config failures return a proper status instead of a broken `200` stream.
**API keys are never logged.**

### Optional fallback (off by default)

A single, pre-stream, non-looping fallback is available but **disabled by
default** and never silent: it requires `AI_FALLBACK_ENABLED=true` + a configured
`AI_FALLBACK_MODEL` on a **different** provider. It engages only before any token
has streamed (so it never duplicates generation or usage cost), never falls back
to the same provider, and logs a `ai.chat.failover` event. Never point it at a
paid provider unintentionally.

### SSRF posture

The app now connects to a **configurable** remote URL, so provider endpoints come
**only** from trusted server env (`OPENAI_COMPATIBLE_BASE_URL`), never from user
input. A user's chat request carries message text and an optional **logical**
model id that is matched against the registry/catalog — it can never become a URL
or a vendor model name. The provider also rejects non-`http(s)` base URLs.
Operators should point the base URL only at trusted endpoints.

## 4a. Model routing & admin control plane (Phase 4)

Provider/model selection is now **DB-backed and admin-controllable**, while the
gateway remains the provider abstraction and **secrets remain in ENV**.

```
/api/ai/chat → AI service → Routing Engine (pure fn over cached DB snapshot)
                                   │  RouteDecision { providerType, providerModel, biinaModel, reason }
                                   ▼
                            @biina/ai-gateway Provider Router → provider (connection from ENV)
```

Four separated concepts: **provider** (`ai_providers`), **underlying model**
(`ai_models.provider_model_id`), **logical BIINA model** (`ai_models.slug`), and
**consumer display name** (`ai_models.display_name`). Consumers only ever see the
display name.

- **Routing engine** (`server/ai/routing.ts`) is a **pure function** over a cached
  config snapshot (`server/ai/catalog.ts`), so it is fully unit-tested without a
  DB. Priority: explicit approved override → persona → workload → plan → default.
  Capabilities gate routes; invalid config fails clearly (surfaced to admins).
- **Env vs. DB rule**: secrets (API keys, base URLs) live in ENV; operational
  config (enabled, priority, default, persona/workload routes, fallback,
  user-facing names, capabilities, visibility, maintenance) lives in the DB.
  Provider rows store only env-var **reference names** — never values.
- **Admin control plane**: `Admin → AI Control` + `/api/admin/ai/*` (ADMIN-gated,
  Zod-validated, audited, cache-invalidating). Fallback is DB-configured (opt-in,
  never silent, loop-protected). Plans/personas/sovereign fields are present for
  readiness; no billing/region enforcement yet.

Details: [`MODEL_ROUTING.md`](./MODEL_ROUTING.md) · [`AI_CONTROL_PLANE.md`](./AI_CONTROL_PLANE.md).

## 4b. Usage metering, plans & cost controls (Phase 5)

BIINA owns its accounting **independently of any provider**:

```
User → entitlement → quota → routing → provider → usage returned → BIINA usage ledger
```

- **Preflight** (`server/ai/preflight.ts`, in the AI service before any provider
  call): entitlement → context size → hard budget → quota → concurrency. Rejections
  throw typed errors (`not_entitled`/`quota_exceeded`/`rate_limited`/
  `context_too_large`/`budget_exceeded`) mapped to safe statuses (403/429/413/503).
  A rejected request uses no provider and writes no ledger row.
- **Usage ledger** (`usage_events`): one idempotent row per provider-reaching
  request (success/error/cancelled/timeout), written in the service `finally` so
  it survives Stop/disconnect. **No prompt/response text** — accounting is separate
  from content. Provider failures don't consume quota.
- **Pure services** (all unit-tested without a DB): `cost` (never invents tokens),
  `entitlements`, `quota` (day/month/minute, UTC resets), `budget` (soft warn /
  hard block), `concurrency` (per-user slots).
- **Plans** (`plans`, admin-editable): FREE/PRO/BUSINESS/ENTERPRISE/ADMIN with
  request/token/rate/concurrency/context/output limits + allow-lists. ADMIN power
  is an entitlement (unlimited plan), not a code bypass. Output caps flow to the
  provider (`num_predict` / `max_tokens`).
- **Admin**: Usage & Cost dashboard (summary, budget + editable thresholds,
  breakdowns by provider/model/plan/workload/persona, top users, model economics)
  and Plans (edit limits, assign plans, audited). No payments.

Details: [`USAGE_METERING.md`](./USAGE_METERING.md) ·
[`PLANS_AND_ENTITLEMENTS.md`](./PLANS_AND_ENTITLEMENTS.md) ·
[`COST_CONTROLS.md`](./COST_CONTROLS.md).

### System prompt (server-side, layered)

Assembled entirely on the server (`apps/web/src/server/ai/system-prompt.ts`),
never sent to the browser or persisted as a visible message:
`Global BIINA policy + Persona instructions + Feature/context + Conversation`.
Any `system` messages in stored history are dropped before the provider call so
the server-composed policy is authoritative and internal prompts never leak.

### Centralized model registry

There is **one** place that maps logical model ids → provider + vendor model
name + limits. Model names are **never hard-coded** across the app. `AI_DEFAULT_PROVIDER`
and `AI_DEFAULT_MODEL` pick the default; everything else reads the registry.

### The single entry point

```
POST /api/ai/chat      # the ONLY way the UI talks to AI. Provider is invisible to it.
GET  /api/ai/health    # per-provider health for diagnostics
GET  /api/health       # app + database liveness (no secrets in the response)
```

## 5. Data model (target — built in Phase 5)

Vendor-independent by design: usage is recorded against **logical** provider/model
records, so switching vendors never rewrites history.

- `users`, `profiles` — identity and preferences (locale, etc.).
- `conversations`, `messages` — chat persistence (role, content, timestamps).
- `providers`, `models` — the registry, persisted.
- `usage_events` — one row per AI request: `userId, conversationId, provider,
  model, requestId, inputTokens, outputTokens, totalTokens, latencyMs, status, createdAt`.
- `plans` (Free / Pro / Admin), `usage_limits` — configurable daily/monthly caps.

**Never stored:** hidden model reasoning. **Never exposed via API:** internal
system prompts.

### Entitlement / metering

A small service checks the user's plan and usage **before** the gateway calls a
provider; it records a `usage_event` after. Over-limit requests are refused with a
clear, localized error. No payments in the MVP.

## 6. Security posture (applies from day one)

- Provider credentials **server-side only**; never shipped to the browser, never logged.
- No secrets in git. All config via env vars; `.env.example` documents every key.
- Secure, http-only, `SameSite` cookies; HTTPS-only in production.
- Zod validation on every request body; rate limiting on auth and `/api/ai/*`.
- Sensible security headers + CORS; the database is never publicly exposed.
- Health endpoints reveal **status only**, never secret values.

## 7. Internationalization & RTL

The app is bilingual from the start (EN default, AR full RTL), reusing the
marketing site's discipline: message catalogs with EN and AR side by side, the
`dir` attribute driven by locale, and CSS **logical properties** (`margin-inline`,
`padding-inline`, `inset-inline`) so RTL is correct, not mirrored. Brand tokens
are shared with `apps/marketing`.

## 8. Adding a provider later

1. Create `packages/ai-gateway/src/providers/<name>.ts` implementing `AIProvider`.
2. Register it and its models in the **model registry** with the env vars it needs.
3. Add its keys to `.env.example`.
4. Point `AI_DEFAULT_PROVIDER` / `AI_DEFAULT_MODEL` at it if it should be default.

**No frontend, route-handler, or database change is required.** That is the whole
point of the gateway. Switching local Ollama → production vLLM is *config only*.

## 9. Deployment topology (target — see DEPLOYMENT.md / PRODUCTION_DEPLOYMENT.md)

```
Internet → Cloudflare (DNS/TLS)
   ├── biina.ai            → apps/marketing  (static host or VPS)
   └── app.biina.ai        → small Linux VPS
                                └── Docker: [ Next.js app ]──[ PostgreSQL (private volume) ]
                                                   │
                                                   └── HTTPS → external OpenAI-compatible
                                                               vLLM endpoint (e.g. RunPod)
```

The GPU/inference server is **decoupled** from the VPS and reached over HTTPS. The
app scales horizontally later (stateless app containers behind the proxy, Postgres
as the shared state) without re-architecting.
