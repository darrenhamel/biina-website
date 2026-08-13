# BIINA.ai — Enterprise Audit & Change Management

Organization-scoped, permission-gated, append-only audit access + export, plus versioned
configuration snapshots for change management. Code:
[`audit.ts`](../apps/web/src/server/enterprise/audit.ts),
[`policy-store.ts`](../apps/web/src/server/enterprise/policy-store.ts); backed by the
existing `security_events` table (see [`SECURITY.md`](./SECURITY.md)).

## Event model

Enterprise operations emit **metadata-only** security events through the shared
`logSecurityEvent` append-only log — `sso.login`, `sso.rejected`, `scim.*`, `domain.*`,
`enterprise.deployment_assigned`, `enterprise.provider_created`,
`enterprise.security_policy_changed`, `enterprise.retention_changed`,
`enterprise.role_assigned`, `enterprise.audit_exported`, `enterprise.service_account_created`,
and the platform-wide events from earlier phases. An event records *what happened and who
did it* — **never prompts, document content, tokens, or secrets**.

## Org audit access (audit.read)

`queryAudit(filter)` returns events **scoped to one organization** and is reachable only
with the `audit.read` permission (held by owner, org-admin, security-admin, auditor).
Ordinary members cannot read or export the audit log. Filters: time range (`from`/`to`),
`actorUserId`, `event`, and a bounded `limit` (default 500, capped at 5000).

## CSV / JSON export

`exportAudit(filter, format, actorUserId)` produces SIEM-friendly **CSV** or **JSON** of
audit metadata. Export itself is audited (`enterprise.audit_exported`). Export is gated by
`audit.read` and the plan's `audit_export_enabled`.

- `GET /api/org/enterprise/audit` — query (`audit.read`).
- `GET /api/org/enterprise/audit/export` — CSV/JSON download (`audit.read`).

## Redaction

Both query metadata and export run through a redactor that blanks any secret-shaped key
(matching `token|secret|password|key|credential|authorization`) to `[redacted]`. Even if a
metadata field were named like a secret, its value never leaves in an export. Provider base
URLs and API keys are never in events in the first place.

## Immutability

The audit log is **append-only**: events are written via `logSecurityEvent` and there is no
update/delete path exposed to organization users. Records are **not user-editable** — an org
admin can *read and export* history but cannot alter or erase it. (Platform-level retention
governs how long records persist; the audit minimum is 30 days — see
[`RETENTION.md`](./RETENTION.md).)

## SIEM-export readiness

Continuous streaming to an external SIEM (webhook/syslog push) is **readiness** — the
export format is SIEM-friendly today, and a scheduled/streamed feed plugs into the existing
scheduler ([`SCHEDULER.md`](./SCHEDULER.md)) without a new runtime.

## Configuration snapshots & change management

Every security-policy change is **versioned + snapshotted + audited**
(`policy-store.ts`): `updateSecurityPolicy` bumps `version`, writes an immutable
`organization_config_snapshots` row (`kind='security_policy'`, no secrets), and logs
`enterprise.security_policy_changed` with the changed keys. `listConfigSnapshots` returns
the version history (newest first) as compliance evidence of *who changed what, when*.

### High-risk-change confirmation

`HIGH_RISK_POLICY_FIELDS` = `externalAIAllowed`, `externalWritesEnabled`. Changing either
requires **explicit confirmation** at the route (`PUT /api/org/enterprise/security-policy`
rejects with `confirm_required` / 409 unless `confirm: true`). Enabling external AI or
external writes is never a one-click accident.

## Status

- Org-scoped query, CSV/JSON export, redaction, append-only immutability, versioned
  snapshots, high-risk confirm — **IMPLEMENTED**.
- Continuous SIEM streaming — **READINESS**.
