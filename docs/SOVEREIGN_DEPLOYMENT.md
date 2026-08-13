# BIINA.ai — Sovereign Deployment

Architecture for running BIINA.ai as a **sovereign** deployment — private database,
storage, vector store, and inference, restricted egress, local audit and secrets, and
optionally disabled web/connectors/external-AI. This document is deliberately conservative:
it separates what the **code** does from what your **infrastructure** and a **security
review** must do. Read alongside [`ENTERPRISE_ARCHITECTURE.md`](./ENTERPRISE_ARCHITECTURE.md),
[`PRIVATE_DEPLOYMENT.md`](./PRIVATE_DEPLOYMENT.md), and
[`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md).

## Two honesty statements up front

> **Not automatically certified for classified workloads.** BIINA ships the *mechanism* to
> deploy sovereignly. It does not carry, and does not claim, any government or regulatory
> certification. Approval for classified or regulated workloads is a
> **security/compliance review** you perform, not a property of this code.

> **Selecting a "Government" persona does not make a deployment sovereign.** A persona
> (Phase 16) is a preference. Sovereignty comes only from an assigned sovereign
> **deployment profile** plus real, reviewed infrastructure — never from a UI choice.

## What sovereign mode does in code

`SOVEREIGN_MODE_ENABLED=true` flips the **platform baseline** conservative: `platformDefaults()`
sets `externalAIAllowed`, `externalWebSearchAllowed`, `externalConnectorsAllowed`,
`personalConnectorsAllowed`, `scheduledWritesEnabled`, and `researchExternalWebAllowed` to
**false**, and web-search mode to `DISABLED`, unless a deployment profile explicitly
re-allows them. Combined with a sovereign deployment profile (privileged; platform-assigned
only) and the residency router, external egress fails **closed**:
`satisfiesEnterprisePolicy` blocks any `isExternal` provider and the router throws
`NO_COMPLIANT_MODEL_AVAILABLE` rather than silently reaching out. See
[`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md).

## Element-by-element status

Each element is marked **IMPLEMENTED** · **ARCHITECTURALLY READY** · **REQUIRES
INFRASTRUCTURE** · **REQUIRES SECURITY/COMPLIANCE REVIEW**.

| Element | Status | Notes |
| --- | --- | --- |
| Sovereign platform baseline (external off by default) | IMPLEMENTED | `SOVEREIGN_MODE_ENABLED` + `platformDefaults()` |
| Privileged sovereign deployment profile, platform-assigned only | IMPLEMENTED | `assignDeploymentProfile` refuses org self-assign |
| Model-inference residency + external-AI block + no silent fallback | IMPLEMENTED | `satisfiesEnterprisePolicy`, `NO_COMPLIANT_MODEL_AVAILABLE` |
| Private/dedicated inference provider (org/deployment-owned, env-ref secrets) | IMPLEMENTED (control) / REQUIRES INFRASTRUCTURE (the endpoint) | [`PRIVATE_MODELS.md`](./PRIVATE_MODELS.md) |
| Private **database** in-region | ARCHITECTURALLY READY + REQUIRES INFRASTRUCTURE | config points `DATABASE_URL` at the sovereign DB; tenant guards unchanged |
| Private **object storage** in-region | ARCHITECTURALLY READY + REQUIRES INFRASTRUCTURE | storage config points at approved region |
| Private **vector store** in-region | ARCHITECTURALLY READY + REQUIRES INFRASTRUCTURE | `privateVectorStoreRequired` on the profile |
| Restricted **network egress** | REQUIRES INFRASTRUCTURE | enforced by your network policy; code fails closed when external is off |
| **Local audit** (in-region, append-only) | IMPLEMENTED (append-only) + REQUIRES INFRASTRUCTURE (in-region DB) | [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md) |
| **Local secrets** (in-region secret store, env-ref only) | ARCHITECTURALLY READY + REQUIRES INFRASTRUCTURE | no secrets in DB/git; refs resolved locally |
| Disabled **web search / connectors / external AI** | IMPLEMENTED | policy fold + sovereign baseline |
| **Air-gapped** operation | ARCHITECTURALLY READY + REQUIRES INFRASTRUCTURE | no outbound needed when external is off + local providers; requires an air-gapped build/mirror |
| Log redaction (no secrets in logs) | IMPLEMENTED | logger `REDACT_KEYS`, [`PRIVATE_DEPLOYMENT.md`](./PRIVATE_DEPLOYMENT.md) |
| Certification for classified workloads | REQUIRES SECURITY/COMPLIANCE REVIEW | **never claimed automatically** |

## The boundary, stated plainly

- **Code responsibility:** resolve governance most-restrictive, block external egress when
  disabled, isolate tenants, keep secrets out of the DB/logs/browser, fail closed, and
  point every data class at whatever infrastructure config names.
- **Infrastructure responsibility (yours):** provide the in-region DB, storage, vector
  store, inference endpoint, secret store, and network controls, and prove they are what
  they claim to be.
- **Review responsibility (yours):** the security/compliance assessment and any
  certification. BIINA provides audit evidence (snapshots, append-only events), not the
  certificate.

Activation steps are enumerated in the
[`UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md`](./UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md).
