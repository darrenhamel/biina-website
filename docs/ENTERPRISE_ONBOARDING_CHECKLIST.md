# BIINA.ai — Enterprise Onboarding Checklist

The end-to-end path to onboard an enterprise/government organization onto BIINA.ai, in
order. Each step maps to an implemented surface; readiness items are flagged. Companions:
[`ENTERPRISE_ARCHITECTURE.md`](./ENTERPRISE_ARCHITECTURE.md),
[`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md), [`SCIM.md`](./SCIM.md),
[`ENTERPRISE_RBAC.md`](./ENTERPRISE_RBAC.md), [`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md),
[`RETENTION.md`](./RETENTION.md), [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).

## Prerequisites

- ☐ `ENTERPRISE_FEATURES_ENABLED=true` (default) and the org's **plan** grants the relevant
  entitlements (`enterprise_features_enabled`, `sso_enabled`, `scim_enabled`,
  `dedicated_provider_allowed`, `data_residency_controls`, `audit_export_enabled`,
  `custom_roles_enabled`). Plan entitlements + platform flags **both** gate a feature.

## Steps

1. ☐ **Create the organization** (Phase 6 org model) and confirm the workspace + owner.
2. ☐ **Assign the deployment profile** — a shared profile by an admin, or a **privileged**
   (dedicated/private-cloud/sovereign) profile by a **platform admin only**
   (`POST /api/admin/enterprise/assign-deployment`). This sets the trusted infrastructure
   boundary the rest folds under.
3. ☐ **Verify the domain** — claim + publish the DNS TXT record + verify
   (`/api/org/enterprise/domains`, `.../verify`). Email domain alone is not proof. See
   [`DOMAIN_VERIFICATION.md`](./DOMAIN_VERIFICATION.md).
4. ☐ **Configure SSO** — OIDC or SAML (`/api/org/enterprise/identity`), secrets as env/
   secret **refs** only. Set enforcement (OPTIONAL/REQUIRED). Register the real crypto
   verifier at activation; SAML also needs `SAML_ENABLED=true`. See
   [`OIDC.md`](./OIDC.md) / [`SAML.md`](./SAML.md).
5. ☐ **Configure SCIM** (optional) — create the org-scoped bearer token
   (`/api/org/enterprise/scim`), store it once, point the IdP at `/api/scim/v2`. Needs
   `SCIM_ENABLED=true` + `scim_enabled`. See [`SCIM.md`](./SCIM.md).
6. ☐ **Create admin roles** — assign built-in roles or define custom roles
   (`/api/org/enterprise/roles`, `.../members/role`). Apply separation of duties; remember
   **no self-escalation**. See [`ENTERPRISE_RBAC.md`](./ENTERPRISE_RBAC.md).
7. ☐ **Set the AI policy** — the org security policy (`/api/org/enterprise/security-policy`):
   `externalAIAllowed`, allowlists, web-search mode, agents/research/memory posture.
   Enabling external AI/writes needs an **explicit confirm**.
8. ☐ **Set allowed connectors** — `allowedConnectors`, `organizationConnectorsRequired`,
   `personalConnectorsAllowed` (Phase 10 controls, tightened here).
9. ☐ **Set retention** — `/api/org/enterprise/retention`; respect platform minimums (audit
   ≥ 30d). See [`RETENTION.md`](./RETENTION.md).
10. ☐ **Set data residency** — `/api/org/enterprise/residency`; required/allowed regions,
    storage/vector/inference regions. See [`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md).
11. ☐ **Grant audit access** — assign `audit.read` (auditor / security-admin) and confirm
    CSV/JSON export works (`audit_export_enabled`). See
    [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).
12. ☐ **(Optional) Register a private provider** — for a dedicated/sovereign model
    (`/api/org/enterprise/providers`), env-ref secrets, region-tagged. See
    [`PRIVATE_MODELS.md`](./PRIVATE_MODELS.md).

## Test before go-live

- ☐ **Provisioning** — SSO/SCIM creates a member bound to **this** org only; an existing
  personal account is linked, not converted.
- ☐ **Deprovisioning** — SCIM deactivation (or admin) sets `active=false`; the user loses
  org access immediately but keeps their personal account/data.
- ☐ **Model routing** — requests obey residency + allowlists; a non-compliant candidate is
  skipped and, if none comply, returns `NO_COMPLIANT_MODEL_AVAILABLE` (no silent external
  fallback).
- ☐ **Tenant isolation** — Org A cannot select Org B's private provider; cross-tenant ids
  → 404; a SCIM token touches only its own tenant.
- ☐ **RBAC** — an auditor is read-only; billing-admin has no security/AI power; a member
  cannot escalate themselves.
- ☐ **Audit** — actions appear as metadata-only events; an export redacts secret-shaped
  keys and is itself audited.
- ☐ **Change management** — a security-policy change bumps the version and writes a
  snapshot; a high-risk change requires confirm.
- ☐ **Arabic / RTL** — the org experience renders correctly in Arabic.

## Reminder

Onboarding configures **controls and evidence**. For a sovereign/region-restricted
deployment, the infrastructure + security + legal reviews in the
[`UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md`](./UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md) are
still required — and a Government persona never, by itself, creates sovereignty.
