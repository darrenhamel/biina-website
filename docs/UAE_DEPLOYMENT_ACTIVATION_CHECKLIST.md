# BIINA.ai — UAE Deployment Activation Checklist

Exact steps to stand up a **UAE-hosted** (or otherwise region-restricted / sovereign)
BIINA.ai deployment. The code ships the control plane; the items below are the
**infrastructure + review** work that BIINA cannot do for you. Nothing here provisions paid
infrastructure automatically — every step is a deliberate human action. Companions:
[`UAE_DEPLOYMENT_READINESS.md`](./UAE_DEPLOYMENT_READINESS.md),
[`SOVEREIGN_DEPLOYMENT.md`](./SOVEREIGN_DEPLOYMENT.md),
[`PRIVATE_DEPLOYMENT.md`](./PRIVATE_DEPLOYMENT.md),
[`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md).

> **No unsupported legal claims.** Completing this checklist configures a region-restricted
> deployment. It does **not** by itself constitute UAE data-residency compliance,
> sovereignty, or any certification — those require the legal/compliance review at the end.

## Completed in code (no action needed)

- Region vocabulary (`UAE | EU | US | OTHER`), residency resolution + intersection, and
  UAE-region model routing with `NO_COMPLIANT_MODEL_AVAILABLE` (no silent external
  fallback).
- Privileged deployment profiles assignable by a **platform admin only**; sovereign
  baseline (`SOVEREIGN_MODE_ENABLED`) that defaults external access off.
- Private UAE providers with tenant isolation + env-ref secrets; redacted health.
- Append-only audit + versioned config snapshots + high-risk-change confirmation.

## Requires human action

### A. Approved UAE hosting
- ☐ Select and **approve** the UAE-region hosting for the app tier (and confirm it is the
  intended jurisdiction).

### B. Database / storage / vector / inference region
- ☐ Provision the **PostgreSQL** database in the UAE region; set `DATABASE_URL`.
- ☐ Provision **object storage** in-region; point storage config at it.
- ☐ Provision the **vector store** in-region; point vector config at it.
- ☐ Stand up **UAE-hosted inference** and register it as a private provider (`region='UAE'`,
  `baseUrlEnvRef`/`apiKeyEnvRef`), then a UAE deployment profile + residency policy
  (`requiredRegions=['UAE']`).

### C. Secrets infrastructure
- ☐ Configure the in-region **secret store**; set only the **referenced** values
  (base URL / API key / OIDC client secret / SAML cert). **Never commit secrets**; they live
  out-of-band and are referenced by name from the DB.

### D. Backup region
- ☐ Configure backups (DB / storage / vector) to an **approved** region; verify restore.

### E. Outbound network policy
- ☐ Enforce the **network egress** policy (allowlist only approved endpoints). With external
  AI/web/connectors disabled, the app already fails closed; the network layer is defense in
  depth.

### F. Logging
- ☐ Confirm logs go to an in-region sink; verify **no secrets** are logged (logger
  `REDACT_KEYS`), and that provider URLs/keys never appear.

### G. Audit retention
- ☐ Set the org/deployment **retention policy**; confirm the audit minimum (≥ 30 days) and
  your required window. Plan the (readiness) expiration job + any legal hold.

### H. External dependencies
- ☐ Inventory every external dependency (models, search, connectors, telemetry). Disable
  what is not approved; for what remains, confirm it is UAE-region or explicitly permitted
  by the residency policy.

### I. Security review
- ☐ Complete a **security review** of the deployment (isolation, egress, secrets, access,
  audit). BIINA supplies audit evidence (snapshots, append-only events), not the sign-off.

### J. Legal / compliance review
- ☐ Complete the **legal/compliance review** for your jurisdiction and workload. **Do not
  represent the deployment as certified/sovereign/compliant** until this review says so —
  region metadata and a Government persona are **not** evidence.

## Verification (before opening to users)

- ☐ **Residency routing** — a request routes only to a UAE-region provider; a non-UAE
  candidate is skipped and, if none comply, the request returns `NO_COMPLIANT_MODEL_AVAILABLE`
  (never a silent external fallback).
- ☐ **External block** — with external AI off, no `isExternal` provider is ever selected,
  including on override and fallback.
- ☐ **Tenant isolation** — Org A cannot select Org B's private provider; cross-tenant ids
  resolve to 404.
- ☐ **Secrets** — no secret value is in the DB, git, logs, browser, or an audit export.
- ☐ **Profile assignment** — the sovereign/privileged profile can be assigned **only** by a
  platform admin; an org admin attempt is refused.
- ☐ **Arabic / RTL** — the product renders correctly in Arabic (RTL) end to end.

## Reminder

This checklist configures a **region-restricted** BIINA deployment and produces audit
evidence. Sovereignty and any certification come from real in-region infrastructure plus
the security and legal reviews — never from configuration alone, and never from selecting a
Government persona.
