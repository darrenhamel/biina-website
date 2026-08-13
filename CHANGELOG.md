# Changelog

All notable changes to BIINA.ai are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — Foundational build — 2026-08-13

First tagged baseline of the **BIINA.ai** product app (`apps/web`) — a bilingual
(EN/AR, RTL-first) Next.js + TypeScript + Postgres/Drizzle application on the
BIINA AI Gateway. This entry summarizes the foundational build (Phases 11–18) at a
high level; earlier phases (1–10) established the monorepo, gateway, real
providers, model routing + admin control plane, metering/plans, auth/orgs,
billing (test mode), RAG/files, web grounding, and connectors.

### Added
- **Agent engine & safe tool execution (Phase 11)** — server-authoritative action
  risk taxonomy; conservative default policy (destructive/financial `DENY`,
  external communication `REQUIRE_APPROVAL`); global write kill switch (off by
  default), dry-run mode, and per-tool kill switches.
- **Workflows & scheduled automation (Phase 12)** — database-authoritative
  scheduler driven by an authenticated worker tick, unique run keys to prevent
  duplicate fires, stuck-run recovery, a conservative limited catch-up missed-run
  policy, hard step limits, and a separate scheduled-write kill switch.
- **Memory, personalization & context engine (Phase 13)**.
- **Multimodal AI (Phase 14)** — vision, OCR, audio and voice.
- **Advanced research & controlled multi-agent orchestration (Phase 15)** — with
  server-authoritative hard ceilings (parallel agents, total runs, tasks, sources,
  runtime) that model-generated plans and source content can never raise.
- **Personas / experience profiles + controlled template library (Phase 16)** —
  library kill switches, install caps, publish risk ceiling, and per-item platform
  suspension.
- **Enterprise, government & sovereign deployment readiness (Phase 17)** — data
  residency + provider allow-lists, private-provider tenant isolation, SSO/SAML and
  SCIM (off by default), and a sovereign lockdown mode; policy-respecting routing
  with **no silent fallback to a prohibited provider**.
- **Launch-readiness operations (Phase 18)** — production configuration validation
  and fail-safe startup guard, public health/readiness endpoints, admin
  production-readiness check, production-safe seed (plans + deployment profiles
  only), and a first-admin bootstrap that promotes an existing user with **no
  hard-coded credentials**.
- **Production operations documentation (Phase 18)** — operational, AI provider,
  billing, connector, workflow, security, cost-control, and backup/restore
  runbooks; production architecture, disaster recovery, observability, incident
  response, load-testing plan, release process, and pen-test scope
  (`docs/`).

### Security
- Secrets are server-side only and never logged (structured logger with key
  redaction); all configuration via environment variables with a secret-free
  `.env.example`.
- Production security headers, CSP (self + Stripe), HSTS, and same-origin CSRF
  protection on state-changing API requests (`src/middleware.ts`).
- Connector credentials encrypted at rest with AES-256-GCM
  (`CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`).
- Stripe webhooks are signature-verified and idempotent; billing runs in **test
  mode** until a live switch is explicitly approved.

### Notes
- Object storage uses local file storage today (durable S3/R2 slots reserved); the
  vector store is a portable jsonb + cosine store (pgvector reserved) whose indexes
  are rebuildable from source documents.
- Rate limiting is per-process in-memory; a shared DB/cache-backed limiter is
  required for multi-instance deployments.
- Several production layers (edge/CDN/WAF, load balancer, durable storage, worker
  cron) require infrastructure not provisioned in this repository. See
  `docs/PRODUCTION_ARCHITECTURE.md`.

[0.1.0]: https://example.invalid/biina/releases/tag/v0.1.0
