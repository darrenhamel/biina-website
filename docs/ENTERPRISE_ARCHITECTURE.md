# BIINA.ai — Enterprise / Government / Sovereign Architecture

Phase 17 adds the **deployment control layer** that lets the *same* BIINA.ai product run
as shared SaaS, a dedicated tenant, a private cloud, or a sovereign/on-premise deployment
— **via configuration and policy, not forks**. Nothing here is a separate product: the
enterprise layer folds *on top of* the existing routing, policy, org, connector, agent,
research, memory, and audit systems and only ever **tightens** behavior. Code:
`apps/web/src/server/enterprise/`; routing integration in
`apps/web/src/server/ai/routing.ts`; schema Phase 17 section in
`apps/web/src/server/db/schema.ts`; migration
[`0015_enterprise.sql`](../apps/web/drizzle/0015_enterprise.sql).

Companion docs: [`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md) ·
[`OIDC.md`](./OIDC.md) · [`SAML.md`](./SAML.md) · [`SCIM.md`](./SCIM.md) ·
[`DOMAIN_VERIFICATION.md`](./DOMAIN_VERIFICATION.md) ·
[`ENTERPRISE_RBAC.md`](./ENTERPRISE_RBAC.md) ·
[`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md) · [`PRIVATE_MODELS.md`](./PRIVATE_MODELS.md) ·
[`RETENTION.md`](./RETENTION.md) · [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md) ·
[`SOVEREIGN_DEPLOYMENT.md`](./SOVEREIGN_DEPLOYMENT.md) ·
[`PRIVATE_DEPLOYMENT.md`](./PRIVATE_DEPLOYMENT.md) ·
[`UAE_DEPLOYMENT_READINESS.md`](./UAE_DEPLOYMENT_READINESS.md).

## First principle — same product via config, not forks

There is one codebase. A "government" or "sovereign" deployment is not a rewrite; it is
the same application constrained by a **deployment profile** + an **organization security
policy** + a **data-residency policy** + a **retention policy**, all resolved
server-side. This keeps the honesty posture simple: we ship the *mechanism* to be
deployed sovereignly; we do not claim a certification we have not earned. Concretely:

> **Selecting a "Government" persona does NOT make a deployment sovereign.** A persona
> (Phase 16) is a preference. Sovereignty comes only from an assigned deployment profile
> plus real, reviewed infrastructure — never from a UI choice.

## The governance flow

Every AI request and every enterprise surface resolves the same chain. Constraints only
narrow going down; nothing downstream can loosen an upstream rule.

```
User / caller
  → Deployment profile (PLATFORM-managed, trusted infra boundary)
    → Organization security policy (org admin, tighten-only)
      → Data-residency + retention policy
        → identity · models · storage · vector · memory · connectors · search
          · agents · workflows · audit
            → approved infrastructure (providers, DB, storage, secrets)
```

The single entry point is `resolveOrgGovernance(organizationId)`
(`deployment.ts`), which returns `{ deploymentProfile, policy, residency }` already folded
**most-restrictive-wins** across platform → deployment → organization. The AI chat route
(`api/ai/chat/route.ts`) calls it, then `routeConstraintsFor(gov)` to build the enterprise
portion of the router's `RouteContext`. See
[`security-policy.ts`](../apps/web/src/server/enterprise/security-policy.ts) for the fold.

### How "most-restrictive-wins" folds

`combineSecurityPolicy(deployment, org)` starts from `platformDefaults()` and applies each
layer:

- **Booleans AND together** — once any layer sets a capability `false`, it stays `false`.
- **Enums pick the more restrictive** — web-search mode
  (`DISABLED > APPROVED_DOMAINS > PUBLIC_ONLY > STANDARD`) and marketplace mode
  (`DISABLED > ORGANIZATION_ONLY > CURATED_ONLY > PUBLIC_ALLOWED`).
- **Allowlists NARROW** — the effective allowlist is the intersection of the non-empty
  layers (empty = "no additional restriction", not "allow nothing").
- **Numeric ceilings take the minimum** (e.g. `maxAgentSteps`).

Sovereign mode (`SOVEREIGN_MODE_ENABLED=true`) flips the *platform* baseline so external
AI, external web search, external connectors, and personal connectors default **OFF**
unless a deployment profile explicitly re-allows them.

## Deployment types

`deployment_type` enum: `SHARED_SAAS`, `DEDICATED_TENANT`, `PRIVATE_CLOUD`, `SOVEREIGN`,
`ON_PREMISE_READY`. A profile also carries a region, jurisdiction label, tenant-isolation
mode, allowed provider regions/providers, external-access booleans, private-storage/vector
requirements, audit level, an optional retention policy, and a `privileged` flag.
**Privileged profiles (sovereign / private-cloud / dedicated) can only be assigned by a
platform admin** (`assignDeploymentProfile`, `POST /api/admin/enterprise/assign-deployment`)
— never self-assigned by an org admin.

### Honest status per element

Each element below is marked: **IMPLEMENTED** (working in code now) · **ARCHITECTURALLY
READY** (the model/interfaces exist; a real integration plugs in without a redesign) ·
**REQUIRES INFRASTRUCTURE** (needs real hosting/hardware you provision + approve) ·
**REQUIRES SECURITY/COMPLIANCE REVIEW** (a human review/certification, not code).

| Element | Status |
| --- | --- |
| Deployment-profile model + platform-only assignment of privileged profiles | IMPLEMENTED |
| Governance fold (platform → deployment → org, most-restrictive) | IMPLEMENTED |
| Residency-aware model routing + `NO_COMPLIANT_MODEL_AVAILABLE` (no silent external fallback) | IMPLEMENTED |
| Private/dedicated providers with tenant isolation (env-ref secrets) | IMPLEMENTED |
| Provider-independent identity trust logic (OIDC/SAML) + org binding | IMPLEMENTED (structural verifier) |
| Real cryptographic assertion verification (openid-client / SAML library) | ARCHITECTURALLY READY (injectable verifier; register at activation) |
| SCIM 2.0 Users/Groups provisioning + org-scoped token | IMPLEMENTED (gated by `SCIM_ENABLED`) |
| Domain verification (DNS TXT) | IMPLEMENTED (injectable resolver) |
| Enterprise RBAC vocabulary + built-in/custom roles | IMPLEMENTED |
| Org security-policy store + versioned snapshots + high-risk confirm | IMPLEMENTED |
| Retention resolution + platform minimums | IMPLEMENTED; deletion/expiration jobs + legal hold are ARCHITECTURALLY READY |
| Audit query + CSV/JSON export (redacted, append-only) | IMPLEMENTED; SIEM streaming is ARCHITECTURALLY READY |
| Private DB / storage / vector / inference hosting | REQUIRES INFRASTRUCTURE |
| Restricted network egress / air-gap | REQUIRES INFRASTRUCTURE |
| Dedicated-database tenant isolation mode | ARCHITECTURALLY READY (no code change; config points at a dedicated DB) |
| K8s / IaC / containerized sovereign topology | ARCHITECTURALLY READY + REQUIRES INFRASTRUCTURE |
| Service accounts (M2M) | ARCHITECTURALLY READY (created DISABLED) |
| MFA / passkey / IP allowlist enforcement | ARCHITECTURALLY READY (policy columns exist) |
| Regulatory / government certification for classified workloads | REQUIRES SECURITY/COMPLIANCE REVIEW — **never claimed automatically** |

## Feature flags (config.ts)

Flags gate whether a surface is available; they **never** replace server-side
authorization.

- `ENTERPRISE_FEATURES_ENABLED` (default **true**) — master gate for enterprise surfaces
  (`requireOrgPermission` refuses when off).
- `SAML_ENABLED` (default **false**) — SAML SSO off until an org is configured.
- `SCIM_ENABLED` (default **false**) — SCIM provisioning off until configured.
- `DEDICATED_PROVIDER_SUPPORT_ENABLED` (default **true**) — private/dedicated providers.
- `SOVEREIGN_MODE_ENABLED` (default **false**) — hard, conservative platform baseline
  (external AI / web / connectors OFF unless a deployment profile re-allows).

## What this is not

The enterprise layer is a **control plane**. It decides *what is allowed* and *where a
request may run*. It does not, by itself, provision a sovereign data centre, encrypt a
classified network, or produce a compliance certificate. Those are infrastructure +
review responsibilities documented in [`SOVEREIGN_DEPLOYMENT.md`](./SOVEREIGN_DEPLOYMENT.md)
and [`PRIVATE_DEPLOYMENT.md`](./PRIVATE_DEPLOYMENT.md), with activation steps in the
[`UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md`](./UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md).
