# BIINA.ai — Workflow Library

A **WorkflowTemplate** is a shareable, installable automation blueprint. Installing one
creates a **DRAFT workflow that ships NO credentials, NO schedule, and NO standing
authorization.** The installer must configure the schedule/timezone, connection,
approval policy, and budget, and then **explicitly activate** it under the Phase 12
workflow policy before anything runs unattended. Code:
`apps/web/src/server/library/installations.ts`, `server/library/types.ts`
(`workflowTemplateSchema`). Companion docs:
[`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md), [`WORKFLOWS.md`](./WORKFLOWS.md),
[`SCHEDULER.md`](./SCHEDULER.md), [`WORKFLOW_APPROVALS.md`](./WORKFLOW_APPROVALS.md),
[`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md),
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md).

## The template definition

`workflowTemplateSchema` (strict Zod, DATA only):

- `goal` — what the automation should accomplish (1–20 000 chars).
- `agentInstructions` — optional agent brief.
- `allowedTools` — declared tool ids (≤24), validated against `AGENT_TOOLS` (unknown =
  BLOCK).
- `requiredConnectors` — declared connector slugs (≤12).
- `suggestedTrigger` — a **suggestion only**: `{ type: MANUAL | SCHEDULE | CONDITION,
  pattern?: daily | weekly | monthly | once }`. It does **not** create a real schedule.
- `approvalPolicy` — `ASK_EVERY_WRITE` / `ASK_HIGH_RISK_ONLY` / `READ_ONLY_AUTOMATIC`.
- `webSearchEnabled`, `defaultModelProfile`, `inputFields` (declarative typed inputs).

If the suggested trigger is a schedule and the tool set writes, the item classifies as
`SCHEDULED_WRITE` — publishable, but the installed workflow still ships inert.

## Install = a DRAFT that cannot run yet

`installItem` (for a `WORKFLOW_TEMPLATE`) inserts a workflow with:

- `status: 'DRAFT'`, `triggerType: 'MANUAL'` — **no schedule**;
- `goal`, `approvalPolicy` (default `ASK_EVERY_WRITE`), `webSearchEnabled` from the
  immutable snapshot;
- **no** connections, credentials, or standing authorizations of any kind.

The installation row records `installedDefinitionType = WORKFLOW` with `status = DRAFT`.
The suggested trigger is not applied — it is guidance the installer may follow when
configuring the real trigger.

## What the installer must configure before activation

A DRAFT workflow does nothing on its own. To make it run, the installer configures, in
their own account/org, under the existing Phase 12 machinery:

1. a real **trigger** — MANUAL, or a **schedule** with an explicit timezone
   ([`SCHEDULER.md`](./SCHEDULER.md));
2. the **connections** the declared connectors require (OAuth under the installer's
   authority — [`CONNECTOR_SECURITY.md`](./CONNECTOR_SECURITY.md));
3. the **approval policy** and, for any unattended write, a **narrow standing
   authorization** ([`WORKFLOW_APPROVALS.md`](./WORKFLOW_APPROVALS.md));
4. a **budget** and step limits;
5. explicit **activation** (`ACTIVE`), which is itself the entitlement/quota check.

Only then does the scheduler consider the workflow. **Scheduled external writes
additionally require `WORKFLOW_SCHEDULED_WRITES_ENABLED=true` (default off) plus a
standing authorization** — installing a template changes none of that. The curated
*Weekly Sales Review* ships as a DRAFT that reads mail and drafts a review with
`ASK_EVERY_WRITE`; it sends nothing until a person configures and activates it.

## Pre-install disclosure

Same `installDisclosure` as agents: declared tools/connectors, connected vs missing
connectors, required capabilities/plans, `externalWrites`, `dataMovement`,
`startsAsDraft: true`, and `blockers`. The installer sees the full would-be surface —
and that it starts as a draft — up front.

## Caps & kill switches

- **Plan gating**: install requires `plan.libraryEnabled` **and**
  `plan.workflowLibraryEnabled`.
- **Install caps**: capped at
  `min(plan.maxInstalledWorkflows, HARD_MAX_INSTALLED_WORKFLOWS=200)`; reaching it
  returns `403 workflow_cap`.
- **Org policy** and platform switches (`LIBRARY_INSTALLATION_ENABLED`,
  `LIBRARY_SUSPENDED_ITEMS`, `writeCapableAllowed`) apply exactly as for agents.

## Updating & uninstalling

- A security-sensitive update (new tool/connector, higher risk, changed approval) needs
  an explicit confirm; when applied, the workflow **drops back to DRAFT** so the
  installer must reconfigure and re-activate — added capability never carries the old
  activation ([`LIBRARY_PUBLISHING.md`](./LIBRARY_PUBLISHING.md#version-updates--re-review)).
- **Uninstall** sets the workflow `DISABLED` and the installation `UNINSTALLED`; it does
  not revoke OAuth or delete data.

Events: `library.installed` / `library.updated_install` / `library.uninstalled`. All
unattended-execution safety is enforced by the Phase 12 controls
([`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md)) — the library only distributes the
blueprint, never a live, authorized automation.
