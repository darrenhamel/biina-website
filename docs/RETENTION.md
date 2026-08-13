# BIINA.ai — Data Retention

Per-organization data-retention policy with enforced **platform minimums**, resolved the
same most-restrictive way as security policy. Code:
[`retention.ts`](../apps/web/src/server/enterprise/retention.ts); schema
`retention_policies`. Related: [`MEMORY_PRIVACY.md`](./MEMORY_PRIVACY.md),
[`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).

## RetentionPolicy

`retention_policies` (one per org; a null-org row is a platform/deployment template)
carries per-category retention in days — `conversation`, `file`, `audit`, `memory`,
`research`, `workflowRun` — plus `deletionMode` and `legalHoldEnabled`. `null` days means
**keep indefinitely**.

## Precedence + platform minimums

`combineRetention(deployment, org)` folds:

```
Platform minimum → Deployment policy → Organization policy
```

For each category it takes the **minimum** of the deployment and org values (an org may
become *stricter* / shorter where allowed), then **clamps up** to a platform operational
minimum (`PLATFORM_MIN_RETENTION_DAYS`) so retention can never drop below what operations
require. The audit minimum is **30 days** — security audit must survive short org windows;
other categories floor at 1 day. `deletionMode` and `legalHoldEnabled` prefer the org value,
falling back to the deployment value.

## Deletion modes

`deletionMode` (`SOFT_DELETE` default) selects how expired records are removed — a soft
delete (mark + hide, recoverable within a window) versus a hard delete. The mode is chosen
per org/deployment and recorded in the effective policy.

## Legal-hold readiness

`legalHoldEnabled` expresses that records under a legal hold are **exempt from deletion**.
The resolver surfaces the flag today; **hold enforcement** (pinning specific records/
custodians against the expiration job) is **readiness** — a later phase wires the exemption
into the pruning path.

## Expiration-job readiness

`retention.ts` resolves policy and is designed to expose a **dry-run pruning planner**;
destructive pruning is **gated and staged**, not automatic. A background **expiration job**
reuses the existing scheduler (see [`SCHEDULER.md`](./SCHEDULER.md)) rather than inventing a
new runtime; it is **readiness** until activated, so no data is deleted silently.

## Tenant archive / deletion lifecycle

Organization archival/deletion is a **staged** lifecycle (`organizations.orgStatus` gains
`ARCHIVED`, plus `archivedAt`): archive suspends access first; a subsequent, gated deletion
step removes data under the effective retention + any legal hold. This is deliberately
multi-step so a tenant is never destroyed by a single call.

## Endpoints & events

- `GET/PUT /api/org/enterprise/retention` — read/update the policy (`retention.read` /
  `retention.manage`).
- Event: `enterprise.retention_changed` (metadata only).

## Status

- Policy model, precedence + platform minimums (audit ≥ 30d), effective resolution —
  **IMPLEMENTED**.
- Legal-hold enforcement, background expiration job, staged tenant deletion —
  **ARCHITECTURALLY READY / READINESS** (reuses the scheduler; nothing deletes silently).
