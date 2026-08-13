# BIINA.ai — Private & Dedicated Models

Private (organization/deployment) AI providers: an org egresses to its own
dedicated/sovereign inference endpoint, invisible to and unusable by any other tenant.
Because BIINA routes through the vendor-independent gateway, adding a private provider is a
registry entry — no frontend or DB redesign. Code:
[`providers.ts`](../apps/web/src/server/enterprise/providers.ts); routing isolation in
[`routing.ts`](../apps/web/src/server/ai/routing.ts); `ai_providers` Phase 17 columns.
Builds on [`MODEL_ROUTING.md`](./MODEL_ROUTING.md),
[`VLLM_DEPLOYMENT.md`](./VLLM_DEPLOYMENT.md).

## Ownership

`ai_providers.ownerType` classifies every provider:

- **PLATFORM** — shared providers available to everyone (default).
- **ORGANIZATION** — private to one tenant (`ownerOrganizationId`); **never selectable by
  another org**.
- **DEPLOYMENT** — belongs to a deployment profile (sovereign/dedicated infra).

`isExternal` marks a provider that egresses to the public internet / an external vendor;
`privateEndpoint` marks a private/dedicated endpoint. `createPrivateProvider` always sets
`ownerType='ORGANIZATION'`, `isExternal=false`, `privateEndpoint=true` by default.

## Tenant isolation — Org A's provider is unusable by Org B

Enforced structurally in the router. `satisfiesEnterprisePolicy` rejects any
`ORGANIZATION`-owned provider unless `ctx.organizationId` equals its `ownerOrganizationId`
— so a personal request or a different tenant can never select it, in primary routing,
explicit override, or fallback. `orgOwnsProvider(organizationId, providerId)` is the
service-side guard, and `listOrgProviders` only ever returns the owning org's providers.
There is no code path by which one tenant reaches another's private model.

## Env-ref secrets — never in DB or UI

A private provider stores only the **names** of env/secret references
(`baseUrlEnvRef`, `apiKeyEnvRef`) — never the base URL value or API key. This is the same
posture as platform providers: secrets are server-side only, never persisted in the
provider row, never logged, never returned to the browser. The referenced values are set
out-of-band in the secret store.

## Redacted health view

`orgProviderHealth(organizationId)` returns an availability view for enterprise AI admins —
slug, display name, region, enabled, health state, model count, average latency — with **no
credentials** and no endpoint values. Admins can see *that* a provider is healthy without
seeing *how* to reach it.

## Model allowlists

The org security policy's `allowedAIProviders` / `allowedModelProfiles` narrow which
providers/models a tenant may use (empty = no restriction). Combined with residency and the
external-AI block, an org can require that only its private provider (or only approved
regions) serve requests. See [`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md).

## Logical model identities — never vendor names

Models are exposed under **logical** BIINA slugs (`biina`, `biina-learn`, `biina-study`,
`biina-business`, `biina-gov`, …) resolved by routing — never a raw vendor model name. The
frontend never learns which model or vendor answered. A private "government" model is just
`biina-gov` mapped, in the registry, to the org's private provider. This preserves the
core BIINA rule: **the UI talks to AI only through `POST /api/ai/chat`**, provider-blind.

## Endpoints & events

- `GET/POST /api/org/enterprise/providers` — list health / create a private provider
  (`ai_models.read` / `ai_models.manage`), gated by `DEDICATED_PROVIDER_SUPPORT_ENABLED`
  and the plan's `dedicated_provider_allowed`.
- Event: `enterprise.provider_created` (metadata only — slug + region, never secrets).

## Status

- Ownership model, tenant isolation, env-ref secrets, redacted health, allowlists, logical
  identities — **IMPLEMENTED**.
- The actual private inference endpoint (vLLM/Ollama/etc. in the approved region) —
  **REQUIRES INFRASTRUCTURE** (you provision + approve it; BIINA points at it by env ref).
