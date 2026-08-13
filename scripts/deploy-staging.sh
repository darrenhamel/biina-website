#!/usr/bin/env bash
# BIINA.ai — staging deploy. Identical mechanics to production but points at the
# fully-isolated staging env file (separate DB, storage, secrets, TEST billing).
# Staging is where you prove a release before touching production.
#
# Usage:
#   ENV_FILE=.env.staging ./scripts/deploy-staging.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.staging}"
[ -f "$ENV_FILE" ] || { echo "[deploy-staging] ERROR: '$ENV_FILE' not found (copy .env.staging.example)." >&2; exit 1; }

# Reuse the production deploy path with the staging env file. Same gates, isolated target.
ENV_FILE="$ENV_FILE" exec "$ROOT/scripts/deploy-production.sh"
