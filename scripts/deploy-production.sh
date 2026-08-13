#!/usr/bin/env bash
# BIINA.ai — production deploy to the single beta VPS (Hetzner).
#
# WHAT THIS DOES (idempotent, re-runnable):
#   1. Refuses to run without an env file and a clean posture check.
#   2. Runs `validate:production` — BLOCKERS abort the deploy (CI-gateable).
#   3. Applies database migrations (additive-only) against the managed Postgres.
#   4. Builds the image and rolls the web + scheduler containers with a health gate.
#
# WHAT THIS DOES NOT DO (by policy — humans do these, see docs/HUMAN_LAUNCH_ACTIONS.md):
#   • create/pay for any provider account   • change DNS
#   • enable live Stripe billing             • purchase compute
# It only operates on infrastructure you have ALREADY provisioned and whose secrets you
# have ALREADY placed in the env file.
#
# Usage:
#   ENV_FILE=.env.production ./scripts/deploy-production.sh
#   ENV_FILE=.env.production SKIP_MIGRATE=1 ./scripts/deploy-production.sh   # already migrated
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="docker-compose.production.yml"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "env file '$ENV_FILE' not found. Copy .env.production.example and fill it out-of-band. Never commit it."
[ -f "$COMPOSE_FILE" ] || fail "$COMPOSE_FILE not found."

# 1) Never deploy a dirty working tree in CI/prod (a warning locally).
if command -v git >/dev/null 2>&1 && [ -z "${ALLOW_DIRTY:-}" ]; then
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    log "WARNING: working tree is dirty. Set ALLOW_DIRTY=1 to proceed anyway."
    [ -n "${CI:-}" ] && fail "refusing to deploy a dirty tree in CI."
  fi
fi

# 2) Pre-deploy readiness gate — BLOCKERS abort (never prints secret values).
log "Running production configuration validation…"
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a
npm run validate:production -w apps/web || fail "validate:production reported BLOCKERS — deploy aborted. Resolve them and re-run."

# 3) Database migrations (additive-only). Skippable when already applied.
if [ -z "${SKIP_MIGRATE:-}" ]; then
  log "Applying database migrations…"
  npm run db:migrate -w apps/web || fail "migration failed — deploy aborted before touching running containers."
else
  log "SKIP_MIGRATE set — skipping migrations."
fi

# 4) Build + roll the containers.
log "Building image…"
ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build web

log "Starting web + scheduler…"
ENV_FILE="$ENV_FILE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d web scheduler

# 5) Health gate — wait for the web container to report healthy.
log "Waiting for web health…"
for i in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Health.Status}}' biina-web 2>/dev/null || echo unknown)"
  if [ "$status" = "healthy" ]; then log "web is healthy."; break; fi
  [ "$i" -eq 30 ] && fail "web did not become healthy in time — check 'docker logs biina-web'."
  sleep 4
done

log "Deploy complete. Run the production smoke suite next:"
log "  BASE_URL=https://app.biina.ai npm run smoke:production -w apps/web"
