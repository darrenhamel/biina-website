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
| `AI_DEFAULT_PROVIDER` | `mock` (default) or `ollama` |
| `AI_DEFAULT_MODEL` | Optional logical model id; auto-selected if unset |
| `OLLAMA_BASE_URL` | Ollama endpoint (default `http://localhost:11434`) |
| `OLLAMA_MODEL` | Ollama model tag (e.g. `llama3.2:3b`) |
| `OLLAMA_REQUEST_TIMEOUT_MS` | Per-request generation timeout (default 120000) |

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
usage metrics, admin AI diagnostics (`/api/ai/health`), and an OpenAI-compatible
**stub** ready for Phase 3.

**Deferred:** production vLLM/OpenAI-compatible (Phase 3), usage metering & plans
(Phase 4). See [`docs/ROADMAP.md`](./docs/ROADMAP.md).
