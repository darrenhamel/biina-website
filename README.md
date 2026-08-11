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
| `AI_DEFAULT_PROVIDER` | `mock` in Phase 1 (Ollama / vLLM come later) |
| `AI_DEFAULT_MODEL` | Default logical model id (`biina-dev`) |

**Secrets are server-side only and never logged.** Real `.env*` files are
git-ignored; keep them out of version control.

## Health check

```bash
curl http://localhost:3000/api/health
# { "status": "ok", "checks": { "app": "ok", "database": "ok" }, "ai": { ... } }
```

## What is (and isn't) built in Phase 1

**Built:** landing, sign-up/login/logout, sessions + protected routes, account &
settings, the chat interface (streaming, stop, regenerate, copy, empty state),
conversation persistence (create/rename/delete/history), a scalable nav with
feature-disabled areas, persona architecture, admin scaffold, `/api/ai/chat`
behind a **mock provider**, health check, EN/AR + RTL.

**Mocked / deferred:** real AI providers (Ollama + vLLM arrive in Phase 2/3),
usage metering & plans (Phase 4). See [`docs/ROADMAP.md`](./docs/ROADMAP.md).
