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

## Phase 9 — Web search (RAG over the live web)  ☐  *(placeholder)*

- ☐ Extend retrieval to a web-search/fetch tool behind the same trusted-context
  discipline (untrusted-data framing, authorization before generation, no vendor
  coupling). No provider/DB/frontend change to the chat contract.

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
