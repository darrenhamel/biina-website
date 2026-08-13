# BIINA.ai — UAE Deployment Review (Phase 18)

A Phase-18 re-read of the Phase-17 UAE deployment work, categorizing **each dependency** by
what still stands between it and a live UAE-region deployment. Source material:
[`UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md`](./UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md) and
[`UAE_DEPLOYMENT_READINESS.md`](./UAE_DEPLOYMENT_READINESS.md). See also
[`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md),
[`SOVEREIGN_DEPLOYMENT.md`](./SOVEREIGN_DEPLOYMENT.md),
[`PRIVATE_DEPLOYMENT.md`](./PRIVATE_DEPLOYMENT.md).

> **Unchanged honesty posture.** Region tags are configuration, **not** a compliance claim.
> A Government persona does **not** make a deployment sovereign. A real UAE/sovereign
> deployment requires in-region infrastructure **plus** security and legal/compliance
> reviews. Nothing below asserts certification.

Category legend:
- **READY** — implemented in code; works with no further build.
- **CONFIGURED** — implemented and switched on via env/config for a given deployment.
- **REQUIRES PROVIDER** — needs infrastructure/an endpoint to be provisioned by a human.
- **REQUIRES BUSINESS DECISION** — needs a deliberate human choice/approval (jurisdiction,
  vendor, retention window, cost).
- **REQUIRES SECURITY REVIEW** — needs a security and/or legal/compliance sign-off.

---

## Control plane (shipped in code)

| Dependency | Category | Notes |
|---|---|---|
| Region vocabulary (`UAE\|EU\|US\|OTHER`) + residency resolution/intersection | **READY** | In code; region string is metadata, not proof. |
| UAE-region model routing + `NO_COMPLIANT_MODEL_AVAILABLE` (no silent external fallback) | **READY** | Router refuses non-compliant providers. |
| Privileged/sovereign deployment profiles (platform-admin-only) | **READY** | `SOVEREIGN_MODE_ENABLED` defaults external access OFF. |
| Private UAE providers, tenant-isolated, env-ref secrets, redacted health | **READY** | Vendor-independent; logical model ids only. |
| Append-only audit + versioned config snapshots + high-risk-change confirm | **READY** | Supplies audit evidence, not the sign-off. |

## Infrastructure dependencies (must be provisioned)

| Dependency | Category | Notes |
|---|---|---|
| A. Approved UAE hosting for the app tier | **REQUIRES PROVIDER** + **REQUIRES BUSINESS DECISION** | Choosing and approving the jurisdiction is a business decision. |
| B. UAE-region PostgreSQL (`DATABASE_URL`) | **REQUIRES PROVIDER** | Managed, in-region. |
| B. UAE-region object storage | **REQUIRES PROVIDER** | Point `STORAGE_PROVIDER` at it. |
| B. UAE-region vector store | **REQUIRES PROVIDER** | PortableVectorStore (in-DB) or `pgvector`, in-region. |
| B. UAE-hosted inference registered as a private provider | **REQUIRES PROVIDER** → then **CONFIGURED** | `region='UAE'`, env-ref secrets; add deployment profile + residency policy `requiredRegions=['UAE']`. |
| C. In-region secret store | **REQUIRES PROVIDER** | Only referenced values set; never committed. |
| D. Backups to an approved region + verified restore | **REQUIRES PROVIDER** + **REQUIRES SECURITY REVIEW** | Restore must be tested (none tested yet). |
| E. Outbound network egress allowlist | **REQUIRES PROVIDER** + **REQUIRES BUSINESS DECISION** | Defense in depth; app already fails closed. |
| F. In-region logging sink; verify no secrets logged | **REQUIRES PROVIDER** | Logger already redacts (`REDACT_KEYS`). |
| G. Audit retention policy (≥ 30 days + your window) | **REQUIRES BUSINESS DECISION** | Expiration job + legal hold are readiness items. |
| H. External-dependency inventory (models, search, connectors, telemetry) | **REQUIRES BUSINESS DECISION** + **REQUIRES SECURITY REVIEW** | Disable what is not approved for the region. |

## Reviews (cannot be satisfied by configuration)

| Dependency | Category | Notes |
|---|---|---|
| I. Security review of the deployment (isolation, egress, secrets, access, audit) | **REQUIRES SECURITY REVIEW** | BIINA supplies evidence, not the sign-off. |
| J. Legal / compliance review for jurisdiction + workload | **REQUIRES SECURITY REVIEW** | Do not represent as certified/sovereign/compliant until this passes. |

## Verification gates (before opening to users)

| Check | Category | Notes |
|---|---|---|
| Residency routing selects only UAE-region; else `NO_COMPLIANT_MODEL_AVAILABLE` | **READY** (verify live) | No silent external fallback. |
| External block — no `isExternal` provider selected when external AI is off | **READY** (verify live) | Including override + fallback. |
| Tenant isolation — Org A cannot select Org B's private provider (cross-tenant → 404) | **READY** (verify live) | |
| Secrets absent from DB, git, logs, browser, audit export | **READY** (verify live) | |
| Profile assignment restricted to platform admin | **READY** (verify live) | Org-admin attempt refused. |
| Arabic / RTL correct end to end | **READY** (verify live) | |

---

## Summary

- **Shipped and READY:** the entire UAE control plane — region routing, residency
  enforcement, private tenant-isolated providers, audit/snapshots.
- **REQUIRES PROVIDER:** all actual in-region infrastructure (hosting, DB, storage, vector,
  inference, secrets, backups, logging, egress).
- **REQUIRES BUSINESS DECISION:** jurisdiction approval, vendor selection, retention window,
  external-dependency approvals, cost.
- **REQUIRES SECURITY REVIEW:** the security review, the legal/compliance review, and a
  verified backup restore — none of which configuration alone can satisfy.

A UAE deployment is **architecturally ready** and **infrastructure-and-review pending**. It is
not, and must not be represented as, certified or sovereign until the reviews say so.
