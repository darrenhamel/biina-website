# BIINA.ai — Deployment (overview)

> This is the **overview**. The detailed, production-hardened runbook —
> Dockerfiles, compose files, reverse proxy, backups, rollback, and the full
> pre-launch checklist — is produced in **Phase 5** as
> `docs/PRODUCTION_DEPLOYMENT.md`. This file explains the shape and the two
> deploy targets so the picture is clear from the start.
>
> **Nothing here provisions or purchases infrastructure.** Every step that costs
> money or touches DNS is done by a human, on purpose, with approval.

---

## Two things deploy from this monorepo

| Target | Source | Runtime | Where it runs | Domain |
|---|---|---|---|---|
| **Marketing site** | `apps/marketing` | Static HTML | Static host (Vercel / Netlify / Cloudflare Pages) *or* the VPS | `biina.ai` |
| **Product app** | `apps/web` | Node server + Postgres | Small Linux VPS via Docker | `app.biina.ai` |

Keeping them separate means a marketing copy change can never break the app, and
the app's server costs never apply to the static site. The existing
`apps/marketing/netlify.toml` and `vercel.json` already make the static side a
one-click import.

## Target topology (product app)

```
Internet
  │
Cloudflare  (DNS + TLS + optional caching/WAF)
  │
  ├── biina.ai         → apps/marketing  (static)
  │
  └── app.biina.ai     → VPS reverse proxy (Caddy/nginx, TLS)
                            │
                            ▼
                    Docker network on one small Linux VPS
                    ┌───────────────────────────────────────┐
                    │  next-web        (apps/web, stateless) │
                    │      │                                  │
                    │      ▼                                  │
                    │  postgres        (private volume,       │
                    │                   NOT exposed publicly) │
                    └───────────────────────────────────────┘
                            │
                            ▼  HTTPS (server-side only)
                    External OpenAI-compatible vLLM endpoint
                    (e.g. RunPod) — decoupled from the VPS
```

Key properties:

- The **inference GPU server is not on the VPS.** The app reaches it over HTTPS
  using server-side credentials. Swapping local Ollama → production vLLM is a
  change of environment variables only (`AI_DEFAULT_PROVIDER=openai-compatible` +
  the `OPENAI_COMPATIBLE_*` vars) — **no code change, no frontend change.**
- The app containers are **stateless**; Postgres holds all state. To scale
  horizontally later, run more app containers behind the proxy against the same
  database. No re-architecture required.
- **Postgres is never publicly reachable** — it lives on the private Docker
  network with a persistent volume for its data.

## Local development (Phase 1+)

```bash
# from the repo root (npm workspaces)
npm install
docker compose up -d          # Postgres (+ optionally Ollama) for local dev
npm run dev -w apps/web        # the product app  → http://localhost:3000
npm run dev -w apps/marketing  # the marketing site → http://localhost:4321
```

Local AI uses **Ollama** (Phase 3): set `AI_DEFAULT_PROVIDER=ollama`,
`OLLAMA_BASE_URL`, `OLLAMA_MODEL`. Ollama is **not** installed automatically — the
Phase 3 step hands you the official install command to run yourself.

## Configuration & secrets

- Every setting is an **environment variable**. A complete, secret-free
  `.env.example` is committed; real `.env` files are git-ignored (already covered
  by `.gitignore`).
- Provider base URLs and API keys are **server-side only** and never logged.
- Production is **HTTPS-only** with secure cookies and security headers.

### Environment variables (introduced across phases)

| Variable | Phase | Purpose |
|---|---|---|
| `DATABASE_URL` | 1 | Postgres connection string |
| `AUTH_SECRET` / session secret | 1 | Signs session cookies |
| `AI_DEFAULT_PROVIDER` | 2 | `ollama` (dev) or `openai-compatible` (prod) |
| `AI_DEFAULT_MODEL` | 2 | Default logical model id (from the registry) |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | 3 | Local Ollama provider |
| `OPENAI_COMPATIBLE_BASE_URL` | 6/7 | Production vLLM endpoint URL |
| `OPENAI_COMPATIBLE_API_KEY` | 6/7 | Production endpoint key (server-side) |
| `OPENAI_COMPATIBLE_MODEL` | 6/7 | Production model name |

## What a human does (never automated here)

1. Buy/point the domain; create Cloudflare DNS records for `biina.ai` and `app.biina.ai`.
2. Provision the VPS and install Docker (approved, manual).
3. Provision or rent the GPU/vLLM endpoint (Phase 6/7, approved, manual).
4. Set the real secrets in the server environment.

The exhaustive checklist of accounts, DNS records, env vars, and services lives in
`docs/PRODUCTION_DEPLOYMENT.md` (Phase 5).
