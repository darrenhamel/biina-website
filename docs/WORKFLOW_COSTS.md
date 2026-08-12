# BIINA.ai — Workflow Costs & Limits

Automations run on their own, so their spend has to be bounded **without** a human
watching each run. Phase 12 layers workflow-specific entitlements and limits on top of
the existing Phase 5 metering and Phase 10/11 controls — it does **not** invent a
second billing system, and it **never double-counts** provider costs already metered
upstream. Code: `apps/web/src/server/workflows/quotas.ts`, `runner.ts`, `admin.ts`.
Companion docs: [`WORKFLOWS.md`](./WORKFLOWS.md), [`USAGE_METERING.md`](./USAGE_METERING.md),
[`PLANS_AND_ENTITLEMENTS.md`](./PLANS_AND_ENTITLEMENTS.md), [`COST_CONTROLS.md`](./COST_CONTROLS.md).

## Plan entitlements

Phase 12 adds workflow columns to `plans` (a `null` limit means unlimited):

| Column | Meaning |
|---|---|
| `workflowsEnabled` | Whether the plan may use workflows at all. Default **false**. |
| `maxActiveWorkflows` | Cap on simultaneously **ACTIVE** workflows (enforced at activation). |
| `scheduledAutomationsEnabled` | Whether scheduled/condition triggers are allowed (manual still needs only `workflowsEnabled`). |
| `conditionAutomationsEnabled` | Whether condition triggers are allowed. |
| `workflowRunsPerMonth` | Monthly run quota across the plan. |
| `maxWorkflowSteps` | Per-run step ceiling from the plan (folded with workflow + platform limits). |
| `scheduledWritesEnabled` | Plan-level readiness flag for scheduled writes (the global `WORKFLOW_SCHEDULED_WRITES_ENABLED` switch still governs). |

These are re-checked **live at every run** by `checkRunnable`, never assumed from
creation time: kill switch → `workflowsEnabled` → (for scheduled/condition)
`scheduledAutomationsEnabled` → owner/org active + membership → monthly run quota.

## Per-workflow limits

Each workflow (`workflows`) carries its own limits, set at create/edit and validated:

| Limit | Column | Bound (validation) |
|---|---|---|
| Max steps per run | `maxSteps` | 1–20 |
| Max tool calls per run | `maxToolCalls` | 1–40 |
| Max writes per run | `maxWritesPerRun` | 0–5 |
| Max cost per run | `maxCostPerRun` | 0–100 (currency estimate) |
| Max runs per day | `maxRunsPerDay` | 1–100 |
| Max runs per month | `maxRunsPerMonth` | 1–3000 |
| Monthly cost budget | `monthlyCostBudget` | — |
| Overlap policy | `overlapPolicy` | default `SKIP` |
| Consecutive-failure breaker | `maxConsecutiveFailures` | default 5 |

The effective **step cap** for a run is `min(workflow.maxSteps, plan.maxWorkflowSteps,
platform hard limit)`; the run's **cost budget** is `workflow.maxCostPerRun`, passed
straight to the Phase 11 agent session as its `costBudget`; and writes per run are
capped by `maxWritesPerRun` (and a hard ceiling of 5 auto-approvals per run).

## Platform hard limits override everything

Server-controlled ceilings always win over workflow **and** plan settings
(`config.ts`):

| Flag | Default | Effect |
|---|---|---|
| `WORKFLOW_MAX_HARD_STEPS` | `20` | Absolute per-run step ceiling; overrides workflow/plan. |
| `WORKFLOW_MIN_CHECK_INTERVAL_MINUTES` | `15` | Floor on condition-poll interval — no second-by-second polling. |
| `WORKFLOW_MAX_CATCHUP_RUNS` | `1` | Missed-run catch-up cap after downtime. |

A workflow or plan can only make itself **more** restrictive than these; it can never
raise a ceiling.

## Condition-check cost

A condition trigger is not free: each poll is a real run that consumes the monthly run
quota and, if it does model/connector work, meters like any run. Cost is bounded by
`WORKFLOW_MIN_CHECK_INTERVAL_MINUTES` (a workflow cannot poll faster than the platform
floor) and by the same per-run step/tool/cost limits. Condition-watch state
(`workflow_condition_state`) stores cursors + already-seen item hashes so a match isn't
re-processed and re-alerted, avoiding repeated work on the same item.

## Budget stop & run quota

Two independent stops protect spend:

- **Per-run budget (BLOCKED).** When a run's estimated cost reaches `maxCostPerRun`,
  the Phase 11 session blocks; the run finalizes as **BLOCKED** and is surfaced. It
  does not push past its budget to finish.
- **Run quota (SKIPPED).** When the plan's `workflowRunsPerMonth` or the workflow's
  `maxRunsPerMonth` is reached, `checkRunnable` returns `QUOTA_EXCEEDED` and the run is
  finalized as **SKIPPED** before any agent work begins — no wasted spend on a run that
  isn't allowed. (The monthly quota is enforced live; per-workflow daily/monthly caps
  are configured limits on the same run history.)

Reaching the **active-workflow** cap (`maxActiveWorkflows`) blocks *activation*
(`assertUnderActiveWorkflowLimit`) rather than a run, with a 403.

## Rate limits

Automation spend is rate-limited structurally rather than by a token bucket alone: the
minimum check interval floors polling frequency, `overlapPolicy=SKIP` prevents a slow
run from stacking concurrent copies, the daily/monthly run caps bound volume, and the
scheduler processes at most 200 due workflows per tick. Together these keep an
automation from running away between human reviews.

## Usage metering (no double counting)

Each run records operational counters on its `workflow_runs` row —
`stepsExecuted`, `toolCalls`, `writeActions`, and an `estimatedCost` — copied from the
finished agent session. These describe the **automation's** activity (runs, steps, tool
calls, connector ops, writes, notifications) for workflow-level reporting and budgets.

Crucially, this **does not re-bill** model spend: the actual provider/model cost of the
LLM calls a run makes is already metered by **Phase 5** usage events, and connector
operations by **Phase 10** connector metering. The workflow `estimatedCost` is a
run-level roll-up for the per-run budget and dashboards — labelled an estimate, not a
second charge — so a run's model cost is counted **once**, upstream, never twice.

## Cost dashboard

`GET /api/admin/automations` (`automationsOverview`) is the operations/cost view —
**metadata only**, no workflow content, arguments, or recipients:

- kill-switch state (`workflowsEnabled`, `schedulerEnabled`, `scheduledWritesEnabled`);
- workflow counts by status (total / active / paused / auto-paused / draft);
- runs today and a 30-day run breakdown (completed / failed / blocked /
  awaiting-approval / skipped);
- total scheduled **write actions**, **average estimated cost** per run, **queue
  depth** (`QUEUED` runs), and **scheduler health** (overdue ACTIVE workflows);
- a recent-runs list (id, workflow id, status, trigger, write count, timestamp).

Org managers see the same shape scoped to their own organization. This is the surface
for spotting a runaway or expensive automation without exposing any private content.
