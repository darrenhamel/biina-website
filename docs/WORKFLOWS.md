# BIINA.ai — Workflows & Reusable Agents

How BIINA.ai turns a one-off agent run into a **reusable, schedulable automation** —
without becoming a second, unsupervised engine. A workflow is a saved *configuration*
(goal + trigger + sources + limits + approval policy); every time it runs it is
turned into an ordinary **Phase 11 agent run** and passes through the same trusted
gates (planning → policy → approval → tool execution → audit). **Scheduling grants no
new permissions.** Code: `apps/web/src/server/workflows/`. Companion docs:
[`SCHEDULER.md`](./SCHEDULER.md), [`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md),
[`WORKFLOW_APPROVALS.md`](./WORKFLOW_APPROVALS.md),
[`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md),
[`WORKFLOW_COSTS.md`](./WORKFLOW_COSTS.md).

## The one-sentence model

```
A workflow (config) + a trigger (when) → a WorkflowRun (one attempt)
     → a Phase 11 AgentSession (the actual work, same gates as any agent run)
```

A workflow never *is* the execution. `runner.ts` is the single boundary that takes a
queued `WorkflowRun`, re-checks live authority, builds an `AgentSession`, and drives
`advanceAgentSession` from Phase 11. There is **no second execution engine** and no
private write path — the only way a scheduled write proceeds without a person is a
narrow **standing authorization** (see [`WORKFLOW_APPROVALS.md`](./WORKFLOW_APPROVALS.md)).

## Configuration vs. runtime — kept strictly separate

Two concerns never share a row:

| Concern | Table | Mutated by |
|---|---|---|
| **Configuration** (goal, trigger, sources, limits, policy, version) | `workflows`, `workflow_triggers`, `workflow_versions` | management APIs only |
| **Runtime state** (one attempt: status, counters, cost, heartbeat, result) | `workflow_runs` | the runner / scheduler |

A run **never** rewrites the workflow's configuration — it only touches scheduling
bookkeeping (`lastRunAt`, `nextRunAt`, `consecutiveFailures`). No tool a run invokes
can edit the workflow, its schedule, its tools, or its approval policy; that
protection is structural (see [`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md)).

## Ownership — personal XOR organization

`resolveWorkflowAccess` mirrors connector/agent tenant isolation:

- A **PERSONAL** workflow (`ownerType='PERSONAL'`, `userId` set) belongs to its owner
  alone. A foreign id resolves to **null → 404** (no existence leak). The owner can
  manage it.
- An **ORGANIZATION** workflow (`ownerType='ORGANIZATION'`, `organizationId` set)
  belongs to the **org**, not the creator. It is reachable only within *that* org's
  **active** workspace by a verified member; only an **org manager** (`OWNER`/`ADMIN`)
  may create or manage it. Regular members may read within scope; managers manage.

### Execution identity

- **PERSONAL** workflows run **under the owner** (`userId`).
- **ORGANIZATION** workflows run **under the workflow's creator** (`createdByUserId`),
  with a **live membership re-verification** and an **ACTIVE org** required at every
  run (`checkRunnable`). If the creator has left the org or the org is suspended, the
  run does not execute.

Org **service identities** (a dedicated non-human execution account) are documented
as **future readiness** — Phase 12 does **not** create fake user accounts; org
workflows execute under the creating human's live authority.

## Lifecycle

```
          create (always DRAFT)
                 │
                 ▼
             ┌────────┐  activate (validated)   ┌────────┐
             │ DRAFT  │ ──────────────────────► │ ACTIVE │
             └────────┘                          └────────┘
                                                 │  ▲   │
                        pause (manual)           │  │   │ resume
                                    ┌────────────┘  │   └───────────┐
                                    ▼               │               ▼
                               ┌────────┐   N consecutive     ┌─────────────┐
                               │ PAUSED │   failures          │ AUTO_PAUSED │
                               └────────┘   (auto)            └─────────────┘
                                                 │
                                    archive (soft-delete) ▼
                                             ┌──────────┐
                                             │ ARCHIVED │
                                             └──────────┘
```

- **DRAFT** — the only state a newly created workflow starts in. Never auto-scheduled.
  `nextRunAt` stays null.
- **ACTIVE** — enabled and scheduled. Activation re-validates the schedule/timezone
  (must produce a real next run), re-checks plan entitlement, and enforces the
  per-plan **max-active-workflows** limit before flipping status; `setWorkflowStatus`
  recomputes `nextRunAt`.
- **PAUSED** — a manual, immediate stop. No new runs; `nextRunAt` cleared. Resumable.
- **AUTO_PAUSED** — the platform paused it after `maxConsecutiveFailures` (default 5)
  consecutive failing runs; the owner is notified (in-app + email). Resumable by a
  manager once the cause is fixed.
- **ARCHIVED** — a soft delete (`DELETE /api/workflows/[id]`). Scheduling stops
  (`nextRunAt=null`); history is retained. We never hard-delete casually.
- **DISABLED** — reserved in the status enum for platform-level disablement (readiness).

Status changes are audited (`workflow.<status>` security events) and always recompute
`nextRunAt` deterministically.

## Triggers

One active trigger per workflow (`workflow_triggers`). Phase 12 ships three; two more
are reserved in the enum as **readiness only**.

| Trigger | Ships | Meaning |
|---|---|---|
| **MANUAL** | ✅ | Run-now / dry-run only; never auto-scheduled. |
| **SCHEDULE** | ✅ | Recurring by wall-clock: `once` / `daily` / `weekly` / `monthly` (+ restricted `cron`, admin), timezone-aware. |
| **CONDITION** | ✅ | Poll on an interval (`checkIntervalMinutes`, ≥ platform minimum) for an allowlisted condition. |
| **WEBHOOK** | readiness | Inbound event trigger — enum reserved, not built. |
| **CONNECTOR_EVENT** | readiness | Connector push/event trigger — enum reserved, not built. |

**Schedules** are validated and computed by `schedule.ts` — DST-correct, IANA
timezones, monthly day-31 clamped to month end (see [`SCHEDULER.md`](./SCHEDULER.md)).
**Conditions** are drawn from a fixed allowlist — `USAGE_THRESHOLD`,
`CONNECTOR_NEW_ITEMS`, `SEMANTIC_MATCH` — never arbitrary code, and cannot poll faster
than `WORKFLOW_MIN_CHECK_INTERVAL_MINUTES` (default 15). Condition-watch bookkeeping
(cursors + already-alerted item hashes) lives in `workflow_condition_state` to avoid
re-alerting on the same item.

## Inputs & variables

A workflow carries safe setup metadata only — selected knowledge bases
(`knowledgeBaseIds`), connections (`connectionIds`), a `webSearchEnabled` flag, and an
optional `inputs` object — **never** credentials or secrets. At run time the goal text
supports a small, fixed set of **safe variable substitutions** (no scripting):
`{{currentDate}}`, `{{workflowName}}`, `{{organizationName}}`, `{{triggerTime}}`. The
goal itself is treated as server-side instruction; connector/tool content fetched
during a run stays **untrusted data, not instructions**.

## Reusable agent definitions

`agent_definitions` capture a **reusable agent profile** — name, instructions,
allowed tools/connectors, default model profile, step/tool caps, and an approval
policy — so several workflows can share one configured "agent" (e.g. an org's
"Sales Assistant"). A definition holds **configuration and instructions only, never
credentials or identity**, and its custom instructions are **lower priority** than
platform/org/tool policy — a definition can only narrow, never widen, what a run may
do. A workflow may reference one via `agentDefinitionId`.

## Natural-language creation & the compiler

`compiler.ts` lets a user describe an automation in plain language; `POST
/api/workflows/compile` turns it into a **DRAFT** config via `draftFromNaturalLanguage`
— **deterministic heuristics, never executed model JSON**:

- the **text becomes the goal** verbatim;
- simple phrases suggest a schedule ("every morning" → daily, "weekly"/a weekday name
  → weekly, "monthly" → monthly, "check/monitor/watch/when a new…" → a condition
  trigger) and a time-of-day like "8am";
- send/email/post phrasing raises the approval policy to `ASK_EVERY_WRITE` and allows
  one write per run; otherwise it defaults to `READ_ONLY_AUTOMATIC` with zero writes.

The compiler returns a draft **plus validation issues** for the client to review and
edit. Raw LLM output is never trusted to configure or run anything — the user must
review, save (creating a DRAFT), and explicitly activate.

`validateWorkflowConfig` is the shared gate: it checks the timezone is a real IANA id,
that a schedule actually produces a next run, that weekly/monthly/once schedules carry
their required field, that a condition interval meets the platform minimum, and that
steps stay under the platform hard limit. Validation runs on create **and** on
activation.

## Activation review

Before activation the client can show `activationSummary(workflow, trigger, plan)` — a
plain-language description of exactly what the workflow will do: its schedule (pattern
+ time + timezone, or "Check every N min", or "Manual only"), what it can **access**
(knowledge bases, connected apps *read*, web search), whether it performs **external
writes** ("Up to N/run (requires approval or standing authorization)" vs "None"), its
monthly run cap, and its approval policy. Activation itself re-validates and enforces
plan entitlement + the active-workflow limit.

## Dry run & run-now

`runNow(workflow, { dryRun })` (`POST /api/workflows/[id]/run`) creates a **MANUAL**
run and executes it immediately:

- **Run now** executes a real run under every live check, policy, and approval gate —
  scheduling grants nothing extra.
- **Dry run** (`dryRun:true`) plans + previews + performs safe reads but the Phase 11
  session's dry-run flag prevents any write from executing.

Run history is user-safe: `runDetail` exposes the agent session's **operational
steps** (index, type, tool id, status, output summary) and never the model's private
reasoning.

## API surface

```
POST   /api/workflows                       # create (starts DRAFT; never auto-scheduled)
GET    /api/workflows                       # list workflows in the active scope
GET    /api/workflows/[id]                  # detail + trigger + activation summary + recent runs + standing auths
PATCH  /api/workflows/[id]                  # edit (snapshots prior version, bumps version, reschedules)
DELETE /api/workflows/[id]                  # archive (soft delete) + stop scheduling
POST   /api/workflows/[id]/activate         # validate + enable scheduling
POST   /api/workflows/[id]/pause            # immediate temporary stop
POST   /api/workflows/[id]/resume           # resume a PAUSED / AUTO_PAUSED workflow
POST   /api/workflows/[id]/run              # run now (manual) or dry run
POST   /api/workflows/compile               # natural-language → DRAFT config (deterministic)
GET    /api/workflows/templates             # built-in templates (structure only)
GET    /api/workflows/runs/[runId]          # run detail (operational steps, no reasoning) + pending approval
POST   /api/workflows/runs/[runId]/approve  # approve / reject a paused background run
POST   /api/workflows/standing-auth         # create a narrow standing authorization (explicit approval)
GET    /api/workflows/standing-auth         # list the caller's standing authorizations
DELETE /api/workflows/standing-auth/[id]    # revoke immediately
GET    /api/notifications                   # the caller's automation notifications
POST   /api/notifications                   # mark all read
GET    /api/admin/automations               # platform automation health (metadata only)
POST   /api/internal/workflows/tick         # the worker boundary (shared-secret auth) — see SCHEDULER.md
```

All privileged context (plan, org, role, execution identity) is derived server-side,
never from the request body. Everything is gated by `plan.workflowsEnabled`,
scheduled/condition entitlements, run quotas, and the platform kill switches.

## Versioning

Every edit (`PATCH`) first **snapshots the prior configuration** into
`workflow_versions` (immutable, safe fields only, hashed) and bumps `workflows.version`.
Runs record the `workflowVersion` they executed. A **rollback UI** (restoring an
older version) is readiness only — the snapshots exist; the restore flow is not built.

## What Phase 12 ships (and doesn't)

- **Ships:** scheduled **read** automations that run **unattended** end-to-end;
  manual + dry runs; timezone/DST-correct scheduling; condition polling;
  personal/org ownership with live-authority execution; templates; natural-language
  drafting; approvals + narrow standing authorizations; notifications; admin
  observability.
- **Scheduled writes** require **both** a matching standing authorization **and** the
  default-off global `WORKFLOW_SCHEDULED_WRITES_ENABLED` switch — see
  [`WORKFLOW_APPROVALS.md`](./WORKFLOW_APPROVALS.md) and
  [`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md).
- **Readiness only (not built):** WEBHOOK / CONNECTOR_EVENT triggers, org service
  identities, a template marketplace, and a version-rollback UI.
