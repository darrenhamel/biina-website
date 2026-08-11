# CLAUDE.md — BIINA.ai

Guidance for Claude Code (and humans) working in this repository. Read this first.

## What this repo is

Two things live here, and they are **not** the same product:

1. **The marketing site** — a finished, bilingual (EN/AR, RTL-first) **Astro**
   static credibility site for **BIINA**, an Abu Dhabi education-AI company. It has
   no backend and makes deliberately conservative claims. **Keep it. Do not break
   its honesty posture** (see its own README).
2. **The product app** (being built) — a full-stack **BIINA.ai** AI chat
   application: Next.js + TypeScript + PostgreSQL + auth, sitting on top of the
   **BIINA AI Gateway**, a provider abstraction over Ollama / vLLM / (later) OpenAI,
   Anthropic, Gemini.

> **BIINA.ai is the product. LLMs are infrastructure underneath it.** Never couple
> the app to one model or vendor. The frontend must never know which model answered.

### Naming
The build prompts spell the product **"Banaii.ai"**. We brand everything
**BIINA.ai** (matches the repo and marketing site). Treat "Banaii" as a spelling
variant only.

## Repository shape (target)

Monorepo via **npm workspaces**:

```
apps/marketing/     existing Astro static site (moves here in Phase 1)  → biina.ai
apps/web/           Next.js full-stack product app                      → app.biina.ai
packages/ai-gateway/ framework-agnostic provider abstraction (server-side only)
docs/               ARCHITECTURE.md · ROADMAP.md · DEPLOYMENT.md · (later) PRODUCTION_DEPLOYMENT.md
CLAUDE.md
```

**Current on-disk state:** the repo is still the plain Astro site at the root
(`src/`, `astro.config.mjs`, …). The monorepo move is the **first step of Phase 1**,
not done yet.

## How we work here

- **Build in phases.** Follow `docs/ROADMAP.md`. Each phase is one reviewable step
  that leaves the repo working. **Do not build ahead of the current phase.**
- **Explain major architectural changes before making them.**
- **Never delete existing work without explaining why.** The marketing site stays.
- **Plan → docs → code.** `docs/ARCHITECTURE.md` is the source of truth for design.

## Hard rules (never violate)

- **Secrets are server-side only.** AI provider base URLs and API keys never reach
  the browser and are **never logged**. No secrets in git.
- **All config via environment variables**; keep `.env.example` complete and
  secret-free. Real `.env*` files are git-ignored.
- **No hard-coded model names** scattered through the app — one central **model
  registry**. `AI_DEFAULT_PROVIDER` / `AI_DEFAULT_MODEL` choose the default.
- **The UI talks to AI only through `POST /api/ai/chat`** on the same origin —
  never directly to Ollama/vLLM/any vendor.
- **Do not store hidden model reasoning; do not expose internal system prompts** via any API.
- **No paid cloud provisioning, purchases, or destructive production changes**
  without explicit human approval. Don't auto-install system software (e.g. Ollama) —
  hand the user the official command.
- **Bilingual + RTL from the start.** EN default, AR full RTL, CSS logical properties.
- Keep the marketing site's **honesty guardrails** (forward-looking language, no
  unproven partnership/endorsement/availability claims).

## Architecture in one breath

```
Browser → apps/web /api/* (auth, Zod, rate-limit) → services (entitlement/metering,
conversation store) → packages/ai-gateway (registry + provider) → Ollama | OpenAI-compatible (vLLM)
```

Adding a provider later = a new adapter in `packages/ai-gateway` + a registry entry
+ env vars. **No frontend/DB change.** That is the whole point of the gateway.

## Environment / tooling (verified in this environment)

- Node 22, npm 10 · Docker 29 + Compose v5 · PostgreSQL 16 client available.
- **Ollama is not installed** (expected until Phase 3).
- `node_modules` is not present on a fresh clone — run `npm install` first.

## Commands

Marketing site (works today, from repo root until it moves to `apps/marketing`):

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # → dist/
npm run preview
```

Product app (once scaffolded in Phase 1, from repo root):

```bash
npm install
docker compose up -d           # local Postgres (+ optional Ollama)
npm run dev -w apps/web         # http://localhost:3000
npm run lint  -w apps/web
npm run test  -w apps/web
```

## Key docs

- `docs/ARCHITECTURE.md` — target architecture (source of truth).
- `docs/ROADMAP.md` — the phased plan (maps to the 8 build prompts).
- `docs/DEPLOYMENT.md` — deploy topology overview; `PRODUCTION_DEPLOYMENT.md` comes in Phase 5.
- `apps/marketing/README.md` (currently `README.md`) — marketing site editing & honesty guardrails.
