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

## 4c. Identity, authorization & organizations (Phase 6)

Multi-tenant identity on top of the existing server-authoritative sessions —
hardened, not rewritten.

- **Two distinct authorities.** PLATFORM roles (`USER`/`ADMIN`/`SUPER_ADMIN`) and
  ORG roles (`OWNER`/`ADMIN`/`MEMBER`) never conflate. All role logic lives in one
  pure module (`server/auth/permissions.ts`); routes call guards, never inline
  `role === …`.
- **Hardened auth.** Rate-limited flows, a security-event log, single-use hashed
  verify/reset tokens, change-password (revokes other sessions), no account
  enumeration, session listing + revocation, and account status
  (`ACTIVE`/`SUSPENDED`/`DISABLED`) enforced in `getCurrentUser`.
- **Organizations.** `resolveOrgContext` verifies membership server-side (IDOR-safe
  — a browser org id is never trusted). Owner-count invariant, atomic single-use
  invitations, a workspace cookie that is only a re-verified hint. Conversations
  and usage are attributed to the active workspace. Org plans/routing have schema
  seams but are not activated (payments = Phase 7).
- **Provider-independent email** (`server/email`): identity depends on an
  interface, not a vendor. Dev provider ships; SMTP/Resend/SES drop in later.
- **CSRF** same-origin gate on mutating API calls (middleware) + `SameSite=lax`
  cookies; production **HSTS** + security headers.

Details: [`AUTHENTICATION.md`](./AUTHENTICATION.md) ·
[`AUTHORIZATION.md`](./AUTHORIZATION.md) · [`ORGANIZATIONS.md`](./ORGANIZATIONS.md) ·
[`SECURITY.md`](./SECURITY.md).

## 4d. Payments, subscriptions & commercial plans (Phase 7)

Turns the internal plan architecture into a commercial subscription system —
**without coupling to a payment vendor** and **without touching the AI stack**.

```
BIINA app → BillingService → PaymentProvider interface → StripeProvider → Stripe
```

- **Plan vs. price separation.** A BIINA `plan` (FREE/PRO/…) is the entitlement;
  a `commercial_price` is a sellable offering with a provider price id. The app
  never treats a provider price id as a plan id; one plan can have many prices
  (monthly/annual, AED/USD).
- **Entitlements follow verified billing state.** A signed, idempotent webhook
  re-fetches authoritative subscription state → `plan_assignment` (source
  SUBSCRIPTION/TRIAL/ORGANIZATION) → `recomputeEffectivePlan` →
  `users.plan`/`organizations.plan_slug` → the **unchanged** Phase 5
  quota/entitlement/routing. A checkout redirect is never proof of payment.
- **Server-side ownership.** The browser only references our commercial-price
  UUID; the server maps it to the approved provider price. No provider
  customer/subscription/price id is ever trusted from the client.
- **Stripe adapter** is fetch + `node:crypto` (no SDK), signatures HMAC-verified.
  A second provider = a new adapter, nothing else changes.
- **Two safety flags** (`BILLING_ENABLED`, `BILLING_LIVE_MODE`), both default off;
  live mode never inferred from key presence. Manual admin assignments stay
  distinct from paid subscriptions. No card data stored (hosted checkout/portal).

Details: [`BILLING_ARCHITECTURE.md`](./BILLING_ARCHITECTURE.md) ·
[`SUBSCRIPTIONS.md`](./SUBSCRIPTIONS.md) · [`COMMERCIAL_PLANS.md`](./COMMERCIAL_PLANS.md) ·
[`BILLING_SECURITY.md`](./BILLING_SECURITY.md) · [`STRIPE_SETUP.md`](./STRIPE_SETUP.md) ·
[`PRODUCTION_BILLING_CHECKLIST.md`](./PRODUCTION_BILLING_CHECKLIST.md).

## 4e. Files, knowledge & RAG (Phase 8)

Grounds a chat in the user's own documents via retrieval-augmented generation —
**context infrastructure, not a provider.** RAG never bypasses the Phase 4
routing engine or the Phase 5 quotas; the AI provider owns neither storage nor
knowledge.

```
Ingest:  Upload → FileStorage → DocumentProcessor → chunk → EmbeddingProvider → VectorStore → READY
Chat:    /api/ai/chat → RAG retrieval (scope-verified) → context builder → routing → provider → citations
```

- **Files as opaque data.** Uploads are validated server-side (extension
  whitelist + magic-byte sniff + parser check), stored **outside any public dir**
  under server-generated opaque keys, and **never executed** (no macros/HTML/code;
  malware-scan hook at the storage boundary). PDF/DOCX/TXT/MD/CSV supported;
  scanned PDFs are flagged (OCR is an extension point).
- **Knowledge bases** are owned by a user **XOR** an org and **reuse the Phase 6
  org roles** — personal KB private to owner; org KB readable by members, editable
  by managers. Joining/leaving an org never exposes or deletes personal files.
- **Tenant isolation is structural.** `similaritySearch` filters by trusted scope
  **in the query** (never a global search post-filtered) — Org A can never
  retrieve Org B even at identical similarity.
- **Injection defense.** Retrieved chunks are framed as **untrusted data, not
  instructions**; the server-authoritative policy tells the model never to follow
  in-document instructions. Authorization happens **before** generation — the LLM
  never decides access. Citations reference documents (id/page/section), re-checked
  on click; audit rows record references + scores, never content.
- **Portable defaults, production path.** Ships a jsonb vector store (no
  `pgvector` needed) + a deterministic **lexical** dev embedder so the pipeline
  runs/tests anywhere; production configures Ollama/OpenAI-compatible embeddings +
  (recommended) `pgvector`, behind the same interfaces. Gated by `plan.ragEnabled`
  and per-plan file/KB/storage limits.

Details: [`FILES.md`](./FILES.md) · [`KNOWLEDGE_BASES.md`](./KNOWLEDGE_BASES.md) ·
[`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) · [`VECTOR_STORAGE.md`](./VECTOR_STORAGE.md) ·
[`EMBEDDINGS.md`](./EMBEDDINGS.md) · [`RAG_SECURITY.md`](./RAG_SECURITY.md).

## 4f. Web search & live grounding (Phase 9)

Grounds a chat in the **live public web** — context infrastructure, not a
provider. The LLM never browses directly; every public-web access passes through
BIINA.ai server components, and grounding never bypasses Phase 4 routing or Phase
5 quotas. Reuses Phase 8's citation + injection-framing machinery.

```
Chat → user opt-in web toggle → WebSearchService → WebSearchProvider (search)
     → dedupe + bounded selection → WebPageFetcher (SSRF-guarded)
     → WebContentExtractor → WebGroundingContextBuilder → routing → provider → citations
```

- **The LLM never browses.** It emits no network requests; search, fetch, and
  extraction are BIINA server components. Fan-out is bounded (query/result/page
  budgets) — no autonomous or recursive search loops.
- **SSRF is structural, not configurable.** Every fetched URL must be http/https
  and resolve to a **public global-unicast** address; loopback/private/CGNAT/
  link-local + cloud metadata (`169.254.169.254`)/unique-local/internal hostnames
  are blocked, **re-validated on every redirect**, and re-resolved before connect
  to narrow DNS-rebinding. Byte cap, time budgets, content-type allowlist,
  identifiable UA, no credentials — never a generic proxy.
- **Public/private separation.** The query sent to the provider is the **user's
  question only** — never private document text or conversations; org data is
  never sent to a search vendor. Public web sources and private knowledge stay in
  separate labeled blocks; the model surfaces conflicts instead of merging them.
- **Injection defense.** Fetched pages are **untrusted data, not instructions**;
  the server-authoritative policy tells the model never to follow in-page
  instructions, reveal secrets, exfiltrate, or take actions. Citations reference
  http/https public URLs (never internal/proxy URLs), recording a retrieved-on
  date; audit rows (`web_search_requests`) record counts, never page bodies.
- **Portable default, production path.** Ships a deterministic **mock** search
  provider (no key, no network) so the full pipeline, SSRF, injection defense,
  quotas, and citations run/test anywhere; a real vendor (Brave/Tavily/Bing) is a
  `GenericJsonSearchProvider` adapter + env away. Gated by `WEB_SEARCH_ENABLED`
  (off by default) and per-plan web-search quotas + `maxSourcesPerRequest`. The
  chat route sets an answer mode (`MODEL_ONLY`/`PRIVATE_RAG`/`WEB_GROUNDED`/
  `PRIVATE_RAG_AND_WEB`) via `X-Biina-Answer-Mode`; non-quota web failures degrade
  gracefully (answer without web).

Details: [`WEB_SEARCH.md`](./WEB_SEARCH.md) · [`WEB_GROUNDING.md`](./WEB_GROUNDING.md) ·
[`WEB_SECURITY.md`](./WEB_SECURITY.md) · [`CITATIONS.md`](./CITATIONS.md) ·
[`SEARCH_PROVIDER.md`](./SEARCH_PROVIDER.md).

## 4g. Connectors & external integrations (Phase 10)

Grounds a chat in the user's own **external applications** (Google Drive, Gmail,
Calendar, Slack, …) — **integration infrastructure, not a provider.** The **LLM
never invokes a provider directly**; every external access passes through BIINA
server components, and connectors never bypass Phase 4 routing or Phase 5 quotas.
Reuses Phase 8/9 citation + injection-framing machinery.

```
Biina.ai → ConnectorService → Connector Registry → Provider Adapter → External Service
Chat → user-selected connections → ConnectedSearchService → ToolExecutionService
     → (allowlisted read tool) → adapter → normalized results → grounding block + citations
```

- **The LLM never invokes providers directly.** Search/read run through
  `ToolExecutionService` → `ConnectorService` → adapter; the model only ever sees
  normalized, untrusted **CONNECTED SOURCE** data with provenance.
- **Encrypted credentials.** OAuth tokens are AES-256-GCM encrypted at rest
  (key-versioned, KMS-ready), read/written in one module, and **never** serialized,
  logged, or put in a prompt. Centralized OAuth: single-use bound state, PKCE,
  session-matched callback, explicit redirect URI (no open redirect).
- **Tool allowlist — no arbitrary HTTP.** Only allowlisted tools run; there is no
  "fetch arbitrary URL" / "call arbitrary API" tool, which structurally removes
  SSRF, arbitrary side effects, and exfiltration. Identity is server-derived.
- **Read-only + write-disabled.** Phase 10 reads; write/side-effecting tools are
  registered and risk-classified but **DISABLED** (`ACTION_NOT_ENABLED`), with
  user-confirmation/ActionPreview deferred to Phase 11 (agents).
- **Connection isolation.** A connection is personal **XOR** org; a personal one is
  usable only by its owner, an org one only within that org's active workspace by a
  verified member (Org A ≠ Org B), re-verified per connection before each call.
- **Injection/exfiltration defense.** Connected content is **untrusted data, not
  instructions**; it can never override policy, permissions, or tenant. The
  email→search→send exfiltration chain is broken structurally because the
  send/write half is disabled. Connected data is private — never sent to a web
  search, never a web citation, never cross-tenant. Portable default: the `mock`
  connector runs the whole path offline; Google adapters are read-only + ready.
  Migration `0008` (additive). Gated by `plan.connectorsEnabled` + connected-search
  quotas.

Details: [`CONNECTOR_ARCHITECTURE.md`](./CONNECTOR_ARCHITECTURE.md) ·
[`OAUTH.md`](./OAUTH.md) · [`CONNECTOR_SECURITY.md`](./CONNECTOR_SECURITY.md) ·
[`CONNECTED_SEARCH.md`](./CONNECTED_SEARCH.md) ·
[`GOOGLE_CONNECTORS.md`](./GOOGLE_CONNECTORS.md) ·
[`TOOL_EXECUTION.md`](./TOOL_EXECUTION.md) ·
[`CONNECTOR_ACTIVATION_CHECKLIST.md`](./CONNECTOR_ACTIVATION_CHECKLIST.md).

## 4h. Agent engine & safe tool execution (Phase 11)

Lets BIINA.ai *act* over the Phase 10 tool allowlist — a **bounded,
human-supervised** agent, not an autonomous one. The model **proposes**; BIINA
**authorizes, executes, limits, and audits**. The LLM is never the authority on
permissions, approvals, scopes, billing, or tenant boundaries, and (as always) the
frontend never learns which model answered. Code: `apps/web/src/server/agent/`.

```
Model may:  PROPOSE · PLAN · SELECT a tool · REQUEST an action
BIINA does: VALIDATE · AUTHORIZE · CONFIRM · EXECUTE · LIMIT · AUDIT

Goal → Context Assembly → Plan/Tool Selection → Policy Engine → Approval Gate
     → ToolExecutionService → Connector Adapter → External Service → Result
     → Verification → User Response
```

- **Modes — AGENT is never the default.** CHAT (no tools) · ASSISTED (reads auto,
  writes pause for approval; schema default) · AGENT (adds planning). Every write is
  human-gated in every mode.
- **Central risk taxonomy, model never sets it.** `READ_ONLY` allow ·
  `REVERSIBLE_WRITE` / `EXTERNAL_COMMUNICATION` require approval ·
  `FINANCIAL_OR_COMMITMENT` / `DESTRUCTIVE` / `HIGH_RISK` denied by default.
- **Strict allowlist — no arbitrary HTTP/API/shell tool.** Only catalog tools with
  Zod schemas run; the catalog is filtered to what the context actually has
  (connection, scope, plan, mode, policy), so the model never sees a tool it can't use.
- **Policy engine, most-restrictive-wins.** `decidePolicy` → ALLOW /
  REQUIRE_APPROVAL / DENY; effective policy folds Platform → Org → User (a scope can
  only tighten). Category switches + per-tool overrides + cross-connector gating.
- **Human approval for every write.** Single-use, expiring (`AGENT_APPROVAL_TTL_MS`,
  15 min), hash-bound to the exact normalized args, owner+org-checked; edit → new
  hash. The preview the user sees is exactly what runs; no secrets in it.
- **Execution gauntlet (writes).** kill switches → dry-run → idempotency → live
  policy → consume approval → live connection+scope → live entitlement → server-only
  credential → adapter write → **verify provider id** (no id ⇒ `UNKNOWN_OUTCOME`,
  never success) → meter + audit. No auto-retry on ambiguous outcomes.
- **Bounded + audited.** Step / time / cost limits + loop detection; operational
  steps persisted, **never chain-of-thought**; metadata-only audit + admin/org
  overview; tenant isolation mirrors connectors (personal XOR org, → null → 404).
- **Read-live, write-mock by default.** Reads run through the Phase 10
  `ToolExecutionService`; writes run on the **mock** adapter offline. Real
  Gmail/Calendar/Slack write adapters are structural and require live scopes +
  `AGENT_WRITE_ACTIONS_ENABLED=true` — both **off by default**. Flags:
  `AGENT_EXECUTION_ENABLED` (kill switch), `AGENT_WRITE_ACTIONS_ENABLED` (off),
  `AGENT_DRY_RUN`, `AGENT_DISABLED_TOOLS`, step/runtime limits. Additive schema
  (agent_sessions/steps/actions, approval_requests, agent_policies + plan columns).
  Gated by `plan.agentEnabled` + per-plan session quotas. **Real external writes
  require manual activation.**

Details: [`AGENT_ARCHITECTURE.md`](./AGENT_ARCHITECTURE.md) ·
[`TOOL_POLICY.md`](./TOOL_POLICY.md) ·
[`ACTION_APPROVALS.md`](./ACTION_APPROVALS.md) ·
[`AGENT_SECURITY.md`](./AGENT_SECURITY.md) ·
[`AGENT_EXECUTION.md`](./AGENT_EXECUTION.md) ·
[`AGENT_AUDITING.md`](./AGENT_AUDITING.md) ·
[`AGENT_ACTIVATION_CHECKLIST.md`](./AGENT_ACTIVATION_CHECKLIST.md).

## 4i. Workflows, scheduled automations & reusable agents (Phase 12)

Makes a Phase 11 agent run **reusable and schedulable** — without a second engine. A
workflow is saved *configuration* (goal + trigger + sources + limits + approval
policy); each run is turned into an ordinary Phase 11 `AgentSession` and passes through
the same gates. **Scheduling grants no new permissions.** Code:
`apps/web/src/server/workflows/`.

```
Workflow (config) + Trigger (when) → WorkflowRun (one attempt)
   → runner.ts: LIVE authority recheck → build AgentSession → advanceAgentSession
   → same Phase 11 gauntlet (policy → approval → execute → verify → audit)
```

- **Config vs. runtime, strictly separate.** `workflows` / `workflow_triggers` /
  `workflow_versions` hold configuration; `workflow_runs` holds one attempt. A run
  never rewrites configuration — no tool can edit a workflow, its schedule, its tools,
  or its approval policy; changes come only from authenticated management APIs.
- **Ownership, personal XOR org.** `resolveWorkflowAccess` mirrors connector/agent
  isolation (→ null → 404). Personal workflows run under the owner; **organization**
  workflows run under the **creator** (`createdByUserId`) with **live membership
  re-verification + an ACTIVE org**. Org service identities are readiness only (no fake
  accounts).
- **Lifecycle.** DRAFT (always, on create) → ACTIVE (validated, plan-entitled,
  under the active-workflow cap) → PAUSED / AUTO_PAUSED (after N consecutive failures)
  / ARCHIVED (soft delete). Every transition recomputes `nextRunAt`.
- **Triggers.** MANUAL · SCHEDULE (once/daily/weekly/monthly, DST-correct via `Intl`,
  IANA zones, day-31 clamped) · CONDITION (allowlisted, ≥ min interval). WEBHOOK /
  CONNECTOR_EVENT are reserved (readiness).
- **DB-authoritative scheduler, no in-memory timers.** An authenticated worker calls
  `POST /api/internal/workflows/tick` (shared secret `WORKFLOW_TICK_SECRET`, constant-
  time compare, **no user job payload**, 503 if unset). Each due instant is CLAIMED by
  a `UNIQUE(workflowId, runKey)` insert so concurrent workers can't double-fire;
  `nextRunAt` advances idempotently; stuck RUNNING runs are recovered by heartbeat
  timeout with **no write auto-retry**; missed instants catch up conservatively.
- **Approvals unchanged — one narrow escape hatch.** Every write still pauses for a
  human (run persists as `AWAITING_APPROVAL`, worker freed, owner notified; resume is a
  continuation, not a restart). The **only** unattended write path is a **narrow
  standing authorization** — bound to workflow + tool + connection + exact destination
  allowlist + risk ceiling + limits + expiry, creation *is* the explicit approval,
  consumed **atomically**, live-rechecked, immediately revocable. Scheduled writes also
  need `WORKFLOW_SCHEDULED_WRITES_ENABLED=true` (**default off**, separate from the
  Phase 11 write switch).
- **Live authority every run.** `checkRunnable`: kill switch, plan + scheduled
  entitlement, owner ACTIVE / org ACTIVE + creator membership, monthly run quota.
  Credential drift → `REAUTH_REQUIRED` stops + notifies; suspension halts execution.
- **Bounded + metered.** Per-run step/tool/write/cost caps folded with plan
  (`maxWorkflowSteps`) and platform hard limits (`WORKFLOW_MAX_HARD_STEPS`, default 20);
  budget stop ⇒ BLOCKED, quota ⇒ SKIPPED. Run counters roll up steps/tool-calls/writes/
  estimated cost **without double-counting** Phase 5/10 provider metering. Notifications
  are provider-independent (in-app + email), deduped by `(user, dedupeKey)`. Additive
  schema: agent_definitions, workflows, workflow_versions, workflow_triggers,
  workflow_runs (unique run key), standing_authorizations, workflow_notifications
  (unique dedupe), workflow_condition_state + plan columns.
- **What ships.** Scheduled **read** automations run **unattended** end-to-end;
  scheduled **writes** require **both** a standing authorization **and** the default-off
  scheduled-writes switch. Readiness only: WEBHOOK/CONNECTOR_EVENT triggers, org service
  identities, template marketplace, rollback UI.

Details: [`WORKFLOWS.md`](./WORKFLOWS.md) · [`SCHEDULER.md`](./SCHEDULER.md) ·
[`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md) ·
[`WORKFLOW_APPROVALS.md`](./WORKFLOW_APPROVALS.md) ·
[`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md) ·
[`WORKFLOW_COSTS.md`](./WORKFLOW_COSTS.md).

## 4j. Memory, personalization & the context engine (Phase 13)

Gives BIINA.ai a durable, consent-gated **memory** and a **ContextEngine** that
assembles it — the ONE place memory + personalization become model context. Memory
is a **distinct data category** from conversation history, knowledge bases, profile
settings, and live data; it is selected (not "everything the user said"), scoped,
revocable, and **never authority**. It reuses the Phase 8 **RAG embedding provider +
cosine** — no second vector store. Code: `apps/web/src/server/memory/`.

```
Chat turn → ContextEngine.assembleContext (memory OFF / temporary ⇒ skip)
   → retrieveMemories (authz + status + expiry in SQL WHERE) → rank → budget
   → system-prompt layers (personalization, REMEMBERED CONTEXT)
   → AI Gateway   (memory is background context — never overrides the request,
                   never authorizes an action)
Post-response → maybeExtractCandidates (user's OWN message only; ASK/AUTO)
```

- **Six distinct sources, memory is one.** Conversation history ≠ knowledge (RAG)
  ≠ memory ≠ profile settings ≠ org context ≠ live data. Not all conversation is
  memorized; nothing is auto-saved unless AUTO mode + low-risk.
- **Precedence + budget (`context-engine.ts`).** platform safety > org policy >
  CURRENT REQUEST > workflow/agent objective > explicit profile settings > durable
  memory > history > RAG > connected > web. Budgeted to **≤ 6 items / ≤ 600
  tokens / min relevance**; trimming reduces low-priority retrieved context, never
  policy or the request.
- **Explicit vs. inferred.** Explicit "remember/forget" is deterministic,
  synchronous, full-confidence (chat short-circuits with
  `X-Biina-Answer-Mode: MEMORY_COMMAND`). Inferred candidates come from **the
  user's own message only** (poisoning boundary), via a pluggable extractor with a
  **deterministic offline fallback** here; `ASK` asks, `AUTO` auto-accepts only
  `NORMAL` low-risk. Contradictions **supersede** (newer wins); dedup at cosine
  `≥ 0.95`.
- **Consent + privacy.** Consent lives on the **profile** (`memoryEnabled`,
  `memoryMode` OFF/ASK/AUTO), not env-only. Memory off ⇒ no retrieval + no new
  inferred memory; temporary chat ⇒ no durable memory used or created;
  expired/deleted excluded from retrieval **immediately**. View/edit/delete/
  clear/search + candidate review APIs; clear-all is memory only (not account/
  conversations/files/KBs).
- **Security.** Secrets/credentials + injected instructions blocked from all memory
  paths; system prompts never stored; sensitive/restricted need explicit consent;
  personal **XOR** org domains (`resolveMemoryAccess`, IDOR-safe → null → 404);
  memory ≠ StandingAuthorization (never authorizes an action) and can't reconfigure
  a workflow. Metadata-only audit (`memory.*`), no content in logs.
- **Additive schema + plan columns.** `memories`, `memory_revisions`,
  `memory_candidates`, `memory_usage`, `conversation_summaries`; profile gained
  `responseStyle`/`tone`/`memoryEnabled`/`memoryMode`; plan gained `memoryEnabled`,
  `maxMemories`, `autoMemoryEnabled`, `organizationMemoryEnabled`,
  `memoryRetentionDays`. Flags `MEMORY_ENABLED`, `MEMORY_INFERENCE_ENABLED`,
  `MEMORY_AUTO_SAVE_ENABLED`, `ORGANIZATION_MEMORY_ENABLED` (also plan- + consent-
  gated). APIs: `memory` (+`[id]`, `clear`, `settings`, `candidates` +`[id]`),
  `admin/memory` (health, no content).
- **Readiness only.** Model-backed inferred extraction (offline fallback ships),
  memory consolidation, conversation summarization, full export UI, and background
  expiration cleanup (`markExpiredMemories` exists; no cron wired).

Details: [`MEMORY_ARCHITECTURE.md`](./MEMORY_ARCHITECTURE.md) ·
[`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md) · [`PERSONALIZATION.md`](./PERSONALIZATION.md) ·
[`MEMORY_PRIVACY.md`](./MEMORY_PRIVACY.md) · [`ORGANIZATION_MEMORY.md`](./ORGANIZATION_MEMORY.md) ·
[`MEMORY_SECURITY.md`](./MEMORY_SECURITY.md).

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
