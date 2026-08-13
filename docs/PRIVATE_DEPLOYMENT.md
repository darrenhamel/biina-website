# BIINA.ai — Private Deployment

The **configuration boundary** for running BIINA.ai as a private/dedicated tenant: what
config and secrets point at, how tenant isolation works in shared vs dedicated databases,
and the telemetry/egress/log controls. This is the practical companion to
[`SOVEREIGN_DEPLOYMENT.md`](./SOVEREIGN_DEPLOYMENT.md); see also
[`DEPLOYMENT.md`](./DEPLOYMENT.md) for the base topology.

## The deployment configuration boundary

BIINA is configured entirely via **environment variables**, and every external dependency
is an env/secret **reference**, not a value. A private deployment redirects these config
points at tenant-owned infrastructure — **no code change**:

- **Database** — `DATABASE_URL` points at the tenant's PostgreSQL.
- **Object storage** — storage config points at the tenant's bucket/region.
- **Vector store** — vector config points at the tenant's vector database.
- **AI gateway / inference** — a private provider's `baseUrlEnvRef` / `apiKeyEnvRef` name
  the secrets that reach the tenant's inference endpoint (see
  [`PRIVATE_MODELS.md`](./PRIVATE_MODELS.md)).
- **Secrets** — resolved from the tenant's secret store; **never** in the DB, git, or the
  browser.
- **Observability** — telemetry/error-reporting endpoints are the tenant's (or disabled).

## Database isolation modes

`deployment_profiles.tenantIsolationMode`:

- **`SHARED_DATABASE_TENANT_ISOLATION`** (default) — one database, isolation enforced in
  code: every query is scoped by `organizationId`, personal vs org contexts are mutually
  exclusive (XOR), and cross-tenant ids resolve to 404 with no existence leak. These tenant
  guards are the same ones used throughout Phases 6/10/13/15.
- **`DEDICATED_DATABASE`** — the tenant gets its own database. **This needs no code
  change**: you point `DATABASE_URL` at the dedicated instance. Crucially, the in-code
  tenant guards **remain** in the shared mode — dedicated DB is defense in depth on top of,
  not a replacement for, application-level isolation.

## Containerization / K8s / IaC readiness

BIINA is a standard Next.js app + PostgreSQL; it containerizes and runs under Kubernetes,
and its config surface (env + secret refs) suits Infrastructure-as-Code. A packaged
sovereign/dedicated topology (Helm charts, Terraform modules, air-gapped image mirror) is
**ARCHITECTURALLY READY + REQUIRES INFRASTRUCTURE** — the app is designed for it; the
concrete IaC artifacts and the environment they deploy into are yours to provision and
review.

## Telemetry / error-reporting controls

Any product telemetry or error reporting is configurable and can be pointed at the tenant's
own collector or **disabled** for a private/sovereign deployment. Nothing about a request's
content leaves the deployment through telemetry.

## Network egress policy

When the org/deployment disables external AI, web search, and connectors, the code fails
**closed** — the router refuses external providers (`NO_COMPLIANT_MODEL_AVAILABLE`) and web/
connector surfaces are off. A private deployment additionally enforces egress at the
**network** layer (your responsibility); the two together give defense in depth. See
[`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md).

## Log redaction

The shared logger (`apps/web/src/lib/logger.ts`) redacts any secret-shaped key via
`REDACT_KEYS` before writing a line, and the standing rule is **don't log secrets in the
first place**. Provider base URLs and API keys are never logged; audit events carry
metadata only (see [`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md)). This holds identically
in a private deployment.

## Status summary

- Config-boundary model, env-ref secrets, shared-DB tenant isolation, dedicated-DB via
  config, log redaction, fail-closed egress — **IMPLEMENTED / ARCHITECTURALLY READY**.
- The tenant DB/storage/vector/inference/secret infrastructure, packaged K8s/IaC, and
  network egress enforcement — **REQUIRES INFRASTRUCTURE**.
- Suitability for a specific regulated environment — **REQUIRES SECURITY/COMPLIANCE
  REVIEW**.
