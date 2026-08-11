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

## Phase 4 — Data model, users, usage metering  ☐  *(build prompt 5)*

- ☐ Full schema: profiles, providers, models, usage_events, plans, usage_limits.
- ☐ Migrations + seed/dev data.
- ☐ Metering/entitlement service; gateway checks entitlement before calling a provider.
- ☐ Plans: Free / Pro / Admin, configurable daily/monthly limits. No payments.
- ☐ Tests; update architecture docs.

## Phase 5 — Cheap production deploy prep  ☐  *(build prompt 6)*

- ☐ Production Dockerfile(s), `docker-compose.production.yml`, reverse proxy config.
- ☐ Health checks, restart policies, persistent DB volume, env template.
- ☐ Deploy script, backup strategy, migration procedure, rollback, logging strategy.
- ☐ Security hardening (headers, secure cookies, rate limiting, CORS, DB not exposed).
- ☐ `docs/PRODUCTION_DEPLOYMENT.md` + full deployment checklist. **No deploy.**

## Phase 6 — Production AI inference (OpenAI-compatible vLLM / RunPod)  ☑  *(build prompt 7)*

- ☑ Real `OpenAICompatibleProvider` (SSE `/v1/chat/completions`), wired via config only.
- ☑ Connection test + provider health check + configured-model verification (admin).
- ☑ Per-provider timeouts, conservative connect-only retries, correlation IDs, cancellation.
- ☑ User-facing vs. internal error separation (full remote-failure normalization).
- ☑ Optional admin-gated fallback (off by default, never silent, never mid-stream, no loops).
- ☑ Latency (TTFT) metrics + in-memory admin metrics; `docs/VLLM_DEPLOYMENT.md` + `docs/RUNPOD_SETUP.md`.
- ☑ Proven end-to-end against a local mock OpenAI-compatible server (exact-text probe, streaming,
  persistence, usage). ◐ Real RunPod endpoint pending user-supplied credentials.
- **Deliverable:** cloud-inference-ready; local Ollama ↔ cloud vLLM is a config switch. No deploy.

## Phase 7 — Pre-launch audit  ☐  *(build prompt 8)*

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
