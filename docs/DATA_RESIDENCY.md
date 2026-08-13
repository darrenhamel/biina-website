# BIINA.ai — Data Residency & Regional Routing

Region-aware model routing so an organization's requests only run on providers in approved
regions, with **no silent fallback** to a prohibited provider. Code:
[`residency.ts`](../apps/web/src/server/enterprise/residency.ts),
[`regions.ts`](../apps/web/src/server/enterprise/regions.ts); routing integration in
[`routing.ts`](../apps/web/src/server/ai/routing.ts); schema `data_residency_policies`.
Builds on [`MODEL_ROUTING.md`](./MODEL_ROUTING.md) and
[`AI_CONTROL_PLANE.md`](./AI_CONTROL_PLANE.md).

## Region metadata is NOT a compliance claim

`REGIONS = UAE | EU | US | OTHER` are stable internal identifiers. A provider tagged `UAE`
is **configured as** UAE-hosted; the tag is **not** evidence of any certification. Real
residency is proven by infrastructure + review, not by a string in the database. See
[`UAE_DEPLOYMENT_READINESS.md`](./UAE_DEPLOYMENT_READINESS.md).

## DataResidencyPolicy

`data_residency_policies` (one per org; a null-org row is a platform template) carries:

- `requiredRegions` — regions a model provider **must** be in (empty = no hard requirement).
- `allowedRegions` — regions that are permitted (empty = all permitted).
- `storageRegion`, `vectorRegion`, `modelInferenceRegion` — where each data class should
  live. A required `modelInferenceRegion` also constrains the required set.
- `externalTransferAllowed` — whether data may egress externally.

## Resolution — regions only ever narrow

`combineResidency(deployment, policy)` folds the deployment profile's
`allowedProviderRegions` with the org policy by **intersection** (`resolveResidency` is the
DB entry point; `resolveOrgGovernance` calls it). A region can only be *removed* going down
the chain, never added. `regionSatisfies(region, res)` is the predicate: a provider's region
must be in `requiredRegions` (if any) and in `allowedRegions` (if any).

## Regional model routing

The router's `RouteContext` carries the resolved residency plus `externalAIAllowed` and
provider/model allowlists (built by `routeConstraintsFor`). `satisfiesEnterprisePolicy`
(in [`routing.ts`](../apps/web/src/server/ai/routing.ts)) admits a `(model, provider)` pair
only if it passes **all** of:

1. **Private-provider tenant isolation** — an `ORGANIZATION`-owned provider is usable only
   by its owning org (see [`PRIVATE_MODELS.md`](./PRIVATE_MODELS.md)).
2. **External-AI block** — when `externalAIAllowed === false`, any `isExternal` provider is
   ineligible.
3. **Region residency** — `provider.region` must satisfy `requiredRegions`/`allowedRegions`.
4. **Org allowlists** — provider slug / model slug allowlists (empty = no restriction).

Empty/absent constraints never restrict, so ordinary consumer routing is unaffected.

## `NO_COMPLIANT_MODEL_AVAILABLE` — no silent external fallback

This is the critical honesty guarantee. In `selectRoute`, a candidate model that is
*usable* but violates trusted enterprise policy is **skipped, not returned**; if candidates
exist but none comply, routing throws `NO_COMPLIANT_MODEL_AVAILABLE` rather than a generic
error — and **never** returns a prohibited provider. An explicit user model override must
*also* satisfy the policy — it is never a bypass. `selectFallback` applies the same gate: a
compliance failure is **never** rescued by silently falling back to a prohibited external
provider. The system fails **closed**.

## Storage / vector / memory residency

`storageRegion` / `vectorRegion` and memory placement are expressed in the policy and are
**readiness** for enforcement: the resolver surfaces the intended regions, and physical
placement is realized by pointing storage/vector infrastructure at the approved region
(see [`PRIVATE_DEPLOYMENT.md`](./PRIVATE_DEPLOYMENT.md)). Model-inference residency is
enforced **now** through the router.

## Endpoints & events

- `GET/PUT /api/org/enterprise/residency` — read/update the policy (`security.read` /
  `security.manage`).
- Changes are snapshotted for change management (see
  [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md)).

## Status

- Residency resolution + region-aware inference routing + `NO_COMPLIANT_MODEL_AVAILABLE`
  (no silent external fallback) — **IMPLEMENTED**.
- Physical storage/vector/memory region enforcement — **REQUIRES INFRASTRUCTURE**
  (policy-ready).
- Any regulatory residency certification — **REQUIRES SECURITY/COMPLIANCE REVIEW**
  (never claimed by metadata).
