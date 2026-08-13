# BIINA.ai production image (Next.js standalone). Multi-stage: a full install to build,
# then a minimal non-root runtime containing only the traced standalone output — no dev
# dependencies, no source tree, no secrets, no test data. Pin the base by digest in your
# registry mirror for reproducibility.
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ai-gateway/package.json packages/ai-gateway/package.json
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w apps/web

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs biina
# Standalone server + static assets only.
COPY --from=build --chown=biina:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=biina:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=biina:nodejs /app/apps/web/public ./apps/web/public
USER biina
EXPOSE 3000
# The standalone server entrypoint (path mirrors the monorepo layout).
CMD ["node", "apps/web/server.js"]
