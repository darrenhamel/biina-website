# BIINA.ai — Roadmap

Phased plan. Each phase is a single, reviewable step that leaves the repo in a
working state. Phase numbers map to the eight build prompts. **Do not build ahead
of the current phase.**

Legend: ☐ not started · ◐ in progress · ☑ done

---

## Phase 0 — Planning & initialization  ☑ (this phase)

- ☑ Inspect repo, catalog current state (static Astro marketing site).
- ☑ Confirm brand (**BIINA.ai**) and repo shape (**monorepo, keep both**).
- ☑ Write `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/DEPLOYMENT.md`, `CLAUDE.md`.
- **Stops here.** No product code, no file moves yet.

## Phase 1 — MVP foundation  ☐  *(build prompt 2)*

- ☐ Convert repo to npm workspaces; move Astro site → `apps/marketing/` (verify it still builds).
- ☐ Scaffold `apps/web` (Next.js + TS + Tailwind), reuse brand tokens.
- ☐ Postgres + Prisma wired; initial schema (users, conversations, messages).
- ☐ Server-side auth (Auth.js): sign-up, login, session, account page.
- ☐ Product UI shell: landing, chat interface, conversation sidebar, new conversation,
  history, user settings; minimal admin scaffold.
- ☐ `provider abstraction` stubbed; `/api/health` endpoint.
- ☐ i18n structure (EN default + AR + RTL).
- ☐ `docker-compose.yml` for local dev (Postgres, optional Ollama).
- ☐ Lint, typecheck, tests, `dev`/`build` all green.
- **Deliverable:** end-to-end chat flow working against a stub/echo provider. No deploy.

## Phase 2 — BIINA AI Gateway + local Ollama  ☑  *(build prompts 3 & 4)*

- ☑ `packages/ai-gateway`: `AIProvider` interface, env-driven model registry, standardized response.
- ☑ `OllamaProvider` (implemented) + `OpenAICompatibleProvider` (Phase-3 readiness stub).
- ☑ Streaming, per-request timeouts, `GatewayError` normalization, graceful failure,
  request/conversation IDs, usage metadata, structured logging (never log keys/secrets).
- ☑ `POST /api/ai/chat` (the only AI entry point) + admin `GET /api/ai/health` diagnostics.
- ☑ Server-side system-prompt composition (persona-ready); model discovery helper.
- ☑ Gateway + provider + service unit tests (mocked fetch — no Ollama needed). Docs: "adding a provider".
- ◐ **Live** browser→Ollama→model e2e is code-complete but pending a local Ollama
  install on the dev machine (we don't auto-install). Verified graceful behavior
  with Ollama offline; mock path verified end-to-end.
- **Deliverable:** real streamed requests through the gateway; Ollama-ready. No deploy.

## Phase 4 — Model routing + admin control plane  ☑  *(control-plane track)*

- ☑ DB-backed catalog: `ai_providers`, `ai_models`, `ai_routes`, `ai_settings`,
  `ai_audit_log` (secrets stay in ENV; provider rows hold env-ref names only).
- ☑ Pure routing engine (default/persona/workload/plan priority, capability gating,
  fail-safe validation) + cached config loader; DB-configured fallback (opt-in,
  loop-protected). Gateway `streamChatRoute` executes the route.
- ☑ Admin control plane: `Admin → AI Control` + `/api/admin/ai/*` (ADMIN-gated,
  Zod-validated, audited, cache-invalidating). User model selector (BIINA names).
- ☑ Routing/audit logging; `plan` column + plan/persona/sovereign readiness fields.
- ☑ Migration `0001` + seed catalog; routing unit tests + live authz/mutation checks.

## Phase 5 — Usage metering, plans & cost controls  ☑  *(build prompt 5 — metering track)*

- ☑ `usage_events` ledger (idempotent, no content) + `plans` + `plan_assignments`; cost fields on models; budget fields on settings. Migration `0002` + indexes.
- ☑ Pure services: cost, entitlements, quota (day/month/minute), budget (soft/hard), concurrency.
- ☑ Preflight (entitlement → context → budget → quota → concurrency) before any provider call; post-generation ledger write in the service `finally` (survives Stop/error/fallback).
- ☑ Plans FREE→ADMIN (ADMIN = entitlement, not bypass); output caps to providers; user Usage page; admin Usage & Cost + Plans pages; plan assignment + budget APIs (audited).
- ☑ 18 metering unit tests + live checks (ledger write, rate-limit 429, budget hard-block 503 with admin still reachable, plan assign, authz). No payments.

## Phase 6 — Authentication hardening, user management & organizations  ☑  *(build prompt — identity track)*

- ☑ Central permission service (`server/auth/permissions.ts`): PLATFORM roles
  (USER / ADMIN / SUPER_ADMIN) kept DISTINCT from ORG roles (OWNER / ADMIN / MEMBER).
  No inline `role === 'ADMIN'` anywhere — every gate calls a pure predicate.
- ☑ Hardened auth: rate-limited login/signup/forgot/reset/verify, security-event log,
  change-password (revokes other sessions), forgot/reset (no account enumeration,
  single-use hashed tokens, all-session revoke on reset), email verification,
  session listing + per-session & other-session revocation, account status
  (ACTIVE/SUSPENDED/DISABLED) enforced in `getCurrentUser`.
- ☑ Organizations + memberships + invitations: IDOR-safe `resolveOrgContext`
  (server-verified membership — browser orgId never trusted), owner-count
  protection, atomic single-use invitation accept, workspace cookie (hint only,
  re-verified per request), per-org usage integration + plan/routing readiness.
- ☑ Provider-independent email abstraction (dev provider; no paid vendor). CSRF
  same-origin gate on state-changing API calls; HSTS + security headers.
- ☑ Admin user & org management (suspend/reactivate/disable, super-admin role change,
  org suspend). Migration `0003` (additive). Pure unit tests (authz matrix, slug,
  rate-limit, validation, email safety) + live IDOR/isolation/suspension smoke.
- **Deliverable:** multi-tenant identity ready; NO payments, SSO/SAML, or impersonation.

## Phase 7 — Payments, subscriptions & commercial plans  ☑  *(build prompt — billing track)*

- ☑ Provider-independent billing abstraction (`BillingService` → `PaymentProvider`);
  Stripe adapter via fetch + `node:crypto` (no SDK), all server-side.
- ☑ Plan ↔ commercial-price separation (`commercial_prices`); server maps our
  price UUID → approved provider price. Multi-currency (AED/USD), monthly/annual.
- ☑ `billing_customers` / `subscriptions` / `billing_invoices` /
  `billing_webhook_events` / `billing_config`; `plan_assignments.source` +
  nullable user (org scope). Migrations 0004/0005 (additive).
- ☑ Checkout, billing portal, cancel(at-period-end)/resume/change; signature-
  verified, idempotent, safe-retry webhooks that re-fetch authoritative state.
- ☑ Entitlements follow verified state (grace/trial/expiry) → Phase 5 quotas
  unchanged. Manual vs. paid kept distinct (entitlement `source`).
- ☑ Org billing (owner-only, controlled beta); admin billing overview, MRR/ARR
  per currency, unit economics, reconciliation; tax config layer.
- ☑ Two safety flags (`BILLING_ENABLED`/`BILLING_LIVE_MODE`, both off; live never
  inferred). 28 billing unit tests + 18-check live billing smoke (mock provider).
- **Deliverable:** commercial-ready in TEST mode. No live charges; live activation
  gated by `PRODUCTION_BILLING_CHECKLIST.md`. No marketplace/payouts.

## Phase 8 (infra) — Cheap production deploy prep  ☐  *(build prompt 6)*

- ☐ Production Dockerfile(s), `docker-compose.production.yml`, reverse proxy config.
- ☐ Health checks, restart policies, persistent DB volume, env template.
- ☐ Deploy script, backup strategy, migration procedure, rollback, logging strategy.
- ☐ Security hardening (headers, secure cookies, rate limiting, CORS, DB not exposed).
- ☐ `docs/PRODUCTION_DEPLOYMENT.md` + full deployment checklist. **No deploy.**

## Phase 8 — Production AI inference (OpenAI-compatible vLLM / RunPod)  ☑  *(build prompt 7)*

- ☑ Real `OpenAICompatibleProvider` (SSE `/v1/chat/completions`), wired via config only.
- ☑ Connection test + provider health check + configured-model verification (admin).
- ☑ Per-provider timeouts, conservative connect-only retries, correlation IDs, cancellation.
- ☑ User-facing vs. internal error separation (full remote-failure normalization).
- ☑ Optional admin-gated fallback (off by default, never silent, never mid-stream, no loops).
- ☑ Latency (TTFT) metrics + in-memory admin metrics; `docs/VLLM_DEPLOYMENT.md` + `docs/RUNPOD_SETUP.md`.
- ☑ Proven end-to-end against a local mock OpenAI-compatible server (exact-text probe, streaming,
  persistence, usage). ◐ Real RunPod endpoint pending user-supplied credentials.
- **Deliverable:** cloud-inference-ready; local Ollama ↔ cloud vLLM is a config switch. No deploy.

## Phase 8 — Files, knowledge bases & RAG  ☑  *(build prompt — knowledge track)*

- ☑ File pipeline (`server/rag/`): upload → server-side validation (ext whitelist
  PDF/DOCX/TXT/MD/CSV + magic-byte sniff + parser check) → opaque storage **outside
  any public dir** (random opaque keys, never executed; malware-scan hook) →
  ingestion (`PROCESSING → extract → chunk → embed → vector upsert → READY`,
  never-throws, idempotent reprocess). Scanned PDFs flagged (OCR = extension point).
- ☑ Knowledge bases owned by a user **XOR** an org, **reusing Phase 6 org roles**
  (personal = private; org = members read, managers edit). IDOR-safe
  `resolveKbAccess` (404, no existence leak); joining/leaving an org never
  exposes/deletes personal files.
- ☑ Portable defaults so the pipeline runs/tests anywhere: **jsonb `PortableVectorStore`**
  (no `pgvector`) + **deterministic lexical** dev embedder — with a documented
  production path to `pgvector` + ANN and Ollama/OpenAI-compatible embeddings, behind
  the same `VectorStore`/`EmbeddingProvider` interfaces (per-chunk model/dim for re-embed).
- ☑ Retrieval inside the AI service, **before** generation: scope-verified
  (`knowledgeBaseIds` + workspace), tenant isolation as an **in-query scope filter**
  (Org A ≠ Org B at identical similarity), context builder (numbered SOURCE blocks,
  dedupe, token budget), strict/blended + no-evidence grounding policy.
- ☑ Prompt-injection defense (SOURCE = **untrusted data, not instructions**; system
  policy authoritative; authorization before generation — LLM never decides access).
  Citations (doc/page/section, re-checked on click) via `X-Biina-Citations`;
  `rag_requests` audit (references + scores, no content); admin metadata-only views.
- ☑ Migration `0006` (additive): `knowledge_bases`, `files`, `document_chunks`,
  `rag_requests`; plan fields (`ragEnabled`, `orgKnowledgeAccess`, file/KB/storage
  limits); `conversations.ragKnowledgeBaseIds`/`ragMode`, `messages.citations`.
  Plan-gated (FREE small → ENTERPRISE/ADMIN unlimited). Chunking/embedding/vector/
  isolation unit tests.
- **Deliverable:** documents-grounded chat, portable + tested locally; production
  configures real embeddings + `pgvector`. Docs: `FILES.md`, `KNOWLEDGE_BASES.md`,
  `RAG_ARCHITECTURE.md`, `VECTOR_STORAGE.md`, `EMBEDDINGS.md`, `RAG_SECURITY.md`.

## Phase 9 — Web search & live grounding  ☑  *(build prompt — live-web track)*

- ☑ Web pipeline (`server/web/`): user opt-in toggle → `WebSearchService` →
  `WebSearchProvider` search → dedupe + **bounded** source selection
  (`min(WEB_MAX_PAGES_FETCHED, plan.maxSourcesPerRequest)`) → SSRF-guarded
  `WebPageFetcher` → `WebContentExtractor` → `WebGroundingContextBuilder` →
  routing → provider → answer + citations. The **LLM never browses directly**;
  bounded query/result/page budgets (no autonomous/recursive loops).
- ☑ **SSRF protection** (`ssrf.ts`, not a configurable business setting):
  http/https only; every resolved address must be public global-unicast; blocks
  loopback/private/CGNAT/link-local + cloud metadata (`169.254.169.254`)/
  unique-local/IPv4-mapped/internal hostnames; **re-validated on every redirect**;
  re-resolved before connect (DNS-rebinding). Byte cap + time budgets +
  content-type allowlist + identifiable UA, no credentials, never a proxy.
- ☑ **Injection defense** (`WEB_SOURCE` = **untrusted data, not instructions**;
  server policy authoritative — never follow in-page instructions / reveal
  secrets / exfiltrate / take actions). **Public/private separation**: query to
  the provider is the **user's question only** (never private text); public web
  and private knowledge kept in separate labeled blocks, conflicts surfaced.
- ☑ **Citations** unified across `PRIVATE_DOCUMENT`/`WEB_PAGE`/`SEARCH_SNIPPET`
  (http/https public URLs only, "Retrieved on [date]", no fabrication) via
  `X-Biina-Citations`; answer mode
  (`MODEL_ONLY`/`PRIVATE_RAG`/`WEB_GROUNDED`/`PRIVATE_RAG_AND_WEB`) via
  `X-Biina-Answer-Mode`; non-quota web failures degrade gracefully.
- ☑ **Plan/quota**: `web_search_requests` audit (counts + latencies, no page
  bodies; retention-minimizable query), per-tier web entitlements
  (`webSearchEnabled`, daily/monthly web searches, `maxSourcesPerRequest`,
  `freshnessFiltersEnabled`); failed searches don't count. Migration `0007`
  (additive).
- ☑ **Mock provider default** (deterministic, no key/network) runs+tests the whole
  pipeline; real provider (Brave/Tavily/Bing) = a `GenericJsonSearchProvider`
  adapter + env. Pipeline/SSRF/injection/quota/citation unit tests. Streaming
  preserved (search+fetch, then AI stream; Stop cancels via `AbortSignal`).
- **Deliverable:** live-web-grounded chat, portable + tested locally on the mock
  provider; production configures a real search vendor via env. Docs:
  `WEB_SEARCH.md`, `WEB_GROUNDING.md`, `WEB_SECURITY.md`, `CITATIONS.md`,
  `SEARCH_PROVIDER.md`.

## Phase 10 — Connectors & external integrations  ☑  *(build prompt — connectors track)*

- ☑ Centralized **OAuth** (`oauth.ts`): single-use, expiring, user/connector/type/
  org-**bound** state; **PKCE `S256`** where supported; **session-matched** callback
  (defeats OAuth CSRF/account-linking); **explicit** redirect URI (no open redirect).
  A `mock` provider completes the flow **offline**.
- ☑ **Encrypted credentials** (`crypto.ts`/`credentials.ts`): AES-256-GCM at rest,
  key from `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` (stable, never logged/committed),
  `keyVersion`-tagged for lazy rotation, **KMS-ready** seam. Tokens are never
  serialized, logged, or put in a prompt; one module reads/writes them.
- ☑ **Connection isolation** (`connections.ts`): personal **XOR** org; personal
  usable only by its owner, org usable only within that org's active workspace by a
  verified member (**Org A ≠ Org B**); `resolveConnectionAccess` → null → 404,
  re-verified per connection before each call.
- ☑ **Tool allowlist** (`registry.ts`/`tool-execution.ts`): `ToolExecutionService`
  runs **only** allowlisted tools — **no arbitrary-HTTP/API tool** (structurally
  blocks SSRF/side effects/exfiltration); server-derived identity; capability +
  scope enforced by `ConnectorService`; normalized errors + metering + audit.
- ☑ **Read-only / write-disabled**: read tools (mock/drive/gmail/calendar/slack)
  enabled; write tools (`gmail.send`/`calendar.create`/`drive.delete`) registered +
  risk-classified but **DISABLED** → `ACTION_NOT_ENABLED` (`connector.action_blocked`),
  gated by `CONNECTOR_WRITE_ACTIONS_ENABLED`. No autonomous actions.
- ☑ **Connected grounding + citations** (`connected-search.ts`): explicitly-selected
  connections searched (query = **user's question only**); untrusted **CONNECTED
  SOURCE** blocks (injection defense mirrors RAG/web); `connector` citations,
  permission re-checked on open; private data never web-searched, never cross-tenant.
- ☑ **Plan/quota**: `plans` gained `connectorsEnabled`, max personal/org connections,
  connected-search daily/monthly limits (FREE none → ENTERPRISE/ADMIN unlimited);
  `connector_usage_events` metering (metadata only). Migration `0008` (additive),
  seed registers 5 connectors (mock ENABLED; Google/Slack DISABLED until OAuth set).
- ☑ **Mock-provider default with Google adapters ready**: the full connect → search →
  read → ground → cite path runs offline on `mock`; Google Drive/Gmail/Calendar
  adapters are read-only + correct in shape but not exercised without live creds.
  Crypto/OAuth/isolation/allowlist/connected-search unit tests. Admin → Connectors
  overview (metadata only) + enable/disable.
- **Deliverable:** external-app-grounded chat, portable + tested on the mock
  connector; production activates Google via `CONNECTOR_ACTIVATION_CHECKLIST.md`.
  **Read-only, write-disabled.** Docs: `CONNECTOR_ARCHITECTURE.md`, `OAUTH.md`,
  `CONNECTOR_SECURITY.md`, `CONNECTED_SEARCH.md`, `GOOGLE_CONNECTORS.md`,
  `TOOL_EXECUTION.md`, `CONNECTOR_ACTIVATION_CHECKLIST.md`.
  **Next: Phase 11 — the agent engine** (planning over the tool allowlist +
  ActionPreview/confirmation to safely enable write actions).

## Phase 11 — Agent engine & safe tool execution  ☑  *(build prompt — agent track)*

- ☑ **Bounded, human-supervised orchestrator** (`orchestrator.ts`): model returns
  ONE JSON object per turn (`plan`/`tool`/`final`); BIINA validates + authorizes.
  Reads with an ALLOW policy run immediately; **every write pauses for human
  approval** (`AWAITING_APPROVAL`) and resumes only on a valid one. Step / time /
  cost limits + loop detection (threshold 2). Model turn is injectable for tests.
- ☑ **Central risk taxonomy** (`risk.ts`): `READ_ONLY`→ALLOW,
  `REVERSIBLE_WRITE`/`EXTERNAL_COMMUNICATION`→REQUIRE_APPROVAL,
  `FINANCIAL_OR_COMMITMENT`/`DESTRUCTIVE`/`HIGH_RISK`→DENY. The model **never** sets
  risk. Kill switches: `agentExecutionEnabled` / `agentWriteActionsEnabled` (off) /
  `agentDryRunForced` / `toolKilled`.
- ☑ **Strict tool allowlist** (`tool-catalog.ts`): Zod-schema'd `AGENT_TOOLS`,
  context-aware filtering (mode/plan/connection/scope/policy), output normalization —
  **no arbitrary-HTTP / API / shell tool**.
- ☑ **Policy engine** (`policy.ts`/`policies-store.ts`): `decidePolicy` → ALLOW /
  REQUIRE_APPROVAL / DENY; effective policy folds **Platform → Org → User**
  (most-restrictive-wins; a scope can only tighten). Category switches, per-tool
  overrides, cross-connector gating.
- ☑ **Approvals** (`approvals.ts`/`preview.ts`/`hashing.ts`): single-use
  (APPROVED→CONSUMED atomic), expiring (`AGENT_APPROVAL_TTL_MS`, 15 min default),
  **hash-bound** to exact normalized args, owner+org-checked; ActionPreview (no
  secrets); edit → new hash; rejection tells the agent to stop.
- ☑ **Execution gauntlet** (`execution.ts`/`write-adapters.ts`): kill switches →
  dry-run → idempotency → live policy → consume approval → live connection+scope →
  live entitlement → server-only credential → adapter write → **verify provider id**
  (no id ⇒ `UNKNOWN_OUTCOME`, never success) → meter + audit. **No auto-retry** on
  ambiguous outcomes. Mock adapter (idempotency ledger) runs the path offline; real
  Gmail/Calendar/Slack adapters are structural (need live write scopes).
- ☑ **Persistence + tenant isolation** (`sessions.ts`): agent_sessions/steps/actions,
  personal XOR org (`resolveSessionAccess` → null → 404); **operational steps only,
  NEVER chain-of-thought**. Quotas (`quotas.ts`): plan-gated + daily/monthly session
  limits, effective step cap, run deadline. Admin (`admin.ts`): metadata-only
  overview + audited `setAgentPolicy`.
- ☑ **Plan/quota + schema**: `plans` gained `agentEnabled`, session daily/monthly
  limits, max steps, write-action + external-message daily limits. New tables
  agent_sessions/steps/actions (unique idempotency per session), approval_requests
  (single-use/expiring), agent_policies (PLATFORM/ORGANIZATION/USER). Additive
  migration. Security events `agent.*`; `connector_usage_events` metering.
- ☑ **APIs**: `agent/sessions` (start/list), `agent/sessions/[id]` (detail),
  `.../cancel`, `agent/approvals/[id]` (approve/reject/edit), `admin/agents`
  (overview + platform policy), `orgs/[slug]/agent-policy` (org policy).
- **Deliverable:** a bounded, human-supervised agent — **reads run live, writes run
  on the mock adapter by default**. **Real external writes are NOT auto-enabled**:
  they require live connector write scopes **and** `AGENT_WRITE_ACTIONS_ENABLED=true`
  and the manual steps in `AGENT_ACTIVATION_CHECKLIST.md`. Docs:
  `AGENT_ARCHITECTURE.md`, `TOOL_POLICY.md`, `ACTION_APPROVALS.md`,
  `AGENT_SECURITY.md`, `AGENT_EXECUTION.md`, `AGENT_AUDITING.md`,
  `AGENT_ACTIVATION_CHECKLIST.md`.

## Phase 12 — Workflows, scheduled automations & reusable agents  ☑  *(build prompt — automations track)*

- ☑ **Workflow model** (`store.ts`/`compiler.ts`): config (`workflows` /
  `workflow_triggers` / `workflow_versions`) kept **strictly separate** from runtime
  (`workflow_runs`); a run never rewrites configuration. Personal XOR org isolation
  (`resolveWorkflowAccess` → null → 404); org workflows run under the **creator** with
  live membership + ACTIVE-org re-check. Lifecycle DRAFT → ACTIVE →
  PAUSED/AUTO_PAUSED/ARCHIVED; every transition recomputes `nextRunAt`. Versioning
  snapshots prior config + bumps version (rollback UI = readiness).
- ☑ **Reuse of the Phase 11 engine, no second engine** (`runner.ts`): turns a
  `WorkflowRun` into an `AgentSession` and drives `advanceAgentSession`; **every write
  still pauses for approval**. Failure classification + AUTO_PAUSE after N consecutive
  failures; `resumeWorkflowRunAfterDecision` continues (not restarts) after a human
  decision.
- ☑ **DB-authoritative scheduler** (`scheduler.ts`/`schedule.ts`): no in-memory
  timers; `tick(workerId)` recovers stuck RUNNING runs (heartbeat timeout, **no write
  auto-retry**), selects due workflows, **CLAIMS via `UNIQUE(workflowId, runKey)`** so
  concurrent workers can't double-fire, advances `nextRunAt` idempotently. Timezone/DST
  correct via `Intl`/ICU (IANA ids), monthly day-31 clamped, conservative missed-run
  catch-up.
- ☑ **Worker/tick boundary** (`internal/workflows/tick`): shared-secret
  (`WORKFLOW_TICK_SECRET`) **constant-time** auth, 503 if unset, **no user job
  payload** — loads config from DB by trusted id.
- ☑ **Narrow standing authorizations** (`standing-auth.ts`): the ONLY unattended write
  path — bound to workflow + tool + connection + exact destination allowlist + risk
  ceiling + limits + expiry; creation **is** the explicit approval; **atomic**
  consumption (guarded UPDATE); live recheck + immediate revocation. Scheduled writes
  also need `WORKFLOW_SCHEDULED_WRITES_ENABLED=true` (**default off**, separate from
  Phase 11's write switch).
- ☑ **Live entitlement/authority** (`quotas.ts`): kill switch, plan + scheduled
  entitlement, owner ACTIVE / org ACTIVE + creator membership, monthly run quota;
  active-workflow limit on activation.
- ☑ **Compiler** (`compiler.ts`): `validateWorkflowConfig`; `createWorkflow` (DRAFT +
  first snapshot); `draftFromNaturalLanguage` (**deterministic heuristics — never
  executes model JSON**); `activationSummary`. Built-in **templates** (structure only);
  provider-independent **notifications** (in-app + email, deduped by `(user,
  dedupeKey)`); admin **automationsOverview** (metadata only).
- ☑ **Schema + plan columns**: agent_definitions, workflows, workflow_versions,
  workflow_triggers, workflow_runs (unique run key), standing_authorizations,
  workflow_notifications (unique dedupe), workflow_condition_state; plan gained
  `workflowsEnabled`, `maxActiveWorkflows`, `scheduledAutomationsEnabled`,
  `conditionAutomationsEnabled`, `workflowRunsPerMonth`, `maxWorkflowSteps`,
  `scheduledWritesEnabled`. Additive migration; security events `workflow.*`.
- ☑ **APIs**: `workflows` (create/list), `workflows/[id]` (get/patch/archive),
  `.../activate|pause|resume|run`, `workflows/compile`, `workflows/templates`,
  `workflows/runs/[runId]` (+`/approve`), `workflows/standing-auth` (+`[id]` revoke),
  `notifications`, `admin/automations`, and the worker `internal/workflows/tick`.
- **Deliverable:** scheduled **read** automations that run **unattended** end-to-end,
  reusing the Phase 11 controls. **Scheduled writes are NOT auto-enabled**: they need
  **both** a narrow standing authorization **and** `WORKFLOW_SCHEDULED_WRITES_ENABLED=true`
  (default off) on top of the Phase 11 write switch. Readiness only: WEBHOOK /
  CONNECTOR_EVENT triggers, org service identities, template marketplace, rollback UI.
  Docs: `WORKFLOWS.md`, `SCHEDULER.md`, `AUTOMATION_SECURITY.md`,
  `WORKFLOW_APPROVALS.md`, `WORKFLOW_TEMPLATES.md`, `WORKFLOW_COSTS.md`.

## Phase 10 — Pre-launch audit  ☐  *(build prompt 8)*

- ☐ Audit all 24 areas; run typecheck / lint / tests / prod build / migration validation / dep-security.
- ☐ Categorize findings (BLOCKER / HIGH / MEDIUM / LOW); fix BLOCKER + HIGH locally.
- ☐ Produce **BIINA.ai MVP LAUNCH READINESS** report. Stop before deploying.

---

### Guardrails carried through every phase

- No paid cloud provisioning or purchases without explicit approval.
- No secrets committed; `.env.example` stays complete.
- No deleting existing work without explaining why.
- Explain major architectural changes before making them.
- Keep the honesty posture of the marketing site (forward-looking, no unproven claims).
