# BIINA.ai — Workflow Scheduler

How BIINA.ai decides *when* a workflow runs, durably and exactly once, without any
paid scheduling infrastructure and without in-process timers. The **database is the
authoritative scheduler**: `workflows.nextRunAt` is the single source of truth, and a
lightweight authenticated **worker** advances it by calling one endpoint. Code:
`apps/web/src/server/workflows/scheduler.ts`, `schedule.ts`. Companion docs:
[`WORKFLOWS.md`](./WORKFLOWS.md), [`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md).

## Why the database is authoritative

There are **no in-memory timers**. A serverless / multi-instance web app cannot rely
on `setTimeout`, and a crashed process would silently drop schedules. Instead:

- each ACTIVE scheduled/condition workflow stores its next due instant in
  `workflows.nextRunAt`;
- a worker periodically asks "what is due now?" and the DB answers;
- a run is a durable row (`workflow_runs`) with a **unique key**, so the same instant
  can never fire twice even with several workers.

Restart-durability is free: state lives in Postgres, so a redeploy or crash loses
nothing — the next tick simply picks up whatever is due.

## The worker / tick boundary

```
external cron / durable worker  ── once per minute ──►  POST /api/internal/workflows/tick
                                                          (x-workflow-tick-secret: <shared secret>)
                                                                    │
                                                                    ▼
                                                          scheduler.tick(workerId)
```

`POST /api/internal/workflows/tick` is the **only** entry to the scheduler. It is
designed to be called ~once per minute by any durable trigger — an external cron, a
platform scheduler, or a small always-on worker process.

### Authentication (no user job payload)

- Authenticated with a **shared secret**, `WORKFLOW_TICK_SECRET`, sent in the
  `x-workflow-tick-secret` header and compared in **constant time** (`timingSafeEqual`).
- If `WORKFLOW_TICK_SECRET` is **unset**, the endpoint returns **503** — the scheduler
  is disabled and can never be triggered anonymously.
- The endpoint takes **no user-supplied job payload**. The worker does not tell BIINA
  *what* to run; it only says "advance the scheduler". `tick()` loads all workflow
  configuration from the database **by trusted id**. There is nothing for a caller to
  forge — even a valid caller cannot inject a goal, a tool, or a target.
- An optional `x-worker-id` header (truncated to 40 chars) just labels which worker
  claimed a run, for observability.

## What a tick does

`tick(workerId)` on each call:

1. **Kill-switch check.** If `WORKFLOWS_ENABLED=false` or
   `WORKFLOW_SCHEDULER_ENABLED=false`, it returns immediately (does nothing).
2. **Recover stuck runs.** Any run still `RUNNING` past the heartbeat timeout is
   marked `FAILED` (see *Stuck-run recovery* below).
3. **Select due workflows** — ACTIVE, trigger `SCHEDULE`/`CONDITION`, `nextRunAt <=
   now` (bounded to 200 per tick).
4. For each due workflow, **claim** the instant, **advance** `nextRunAt`, and (if this
   worker won the claim) **execute** the run.

It returns a `TickResult`: `{ claimed, executed[], recovered, skippedDuplicates }`.

## Duplicate-run prevention — the unique run key

Every scheduled instant maps to a **stable run key**:
`scheduledRunKey(scheduledFor) = "sched:<ISO instant>"`. The claim is a single insert:

```
INSERT INTO workflow_runs (workflowId, runKey, scheduledFor, status='QUEUED', …)
ON CONFLICT DO NOTHING          -- UNIQUE(workflowId, runKey)
RETURNING id
```

`workflow_runs` has `UNIQUE(workflowId, runKey)`. Whichever worker inserts first wins
and gets a row id; a **concurrent worker hits the constraint, gets no row, and skips**
(`skippedDuplicates++`). Two workers, or two overlapping ticks, therefore can **never
double-fire the same instant**. Manual runs use a random `manual:<uuid>` key, so they
never collide with schedules or with each other.

`nextRunAt` is then advanced to the *next* computed instant for every due workflow —
**idempotently**, so even the worker that lost the claim moves the clock forward and
the instant is not re-selected on the following tick.

## Concurrency / overlap policy

If a previous run of the same workflow is still in flight when the next instant
arrives, the default `overlapPolicy` is **SKIP** — the workflow does not start a second
concurrent run on top of an unfinished one. (The column is `workflows.overlapPolicy`,
default `SKIP`.) This keeps a slow or approval-blocked run from stacking up.

## Timezone & DST handling

Scheduling is **wall-clock in the workflow's IANA timezone**, computed in `schedule.ts`
with **no timezone dependency** — DST is never hand-computed:

- `zoneOffsetMinutes` reads a zone's **actual offset at a given instant** from the
  platform `Intl`/ICU timezone database, then `zonedWallClockToUtc` solves for the UTC
  instant whose local wall clock in the target zone matches the desired time (a second
  pass corrects the offset-changed edge around a DST transition).
- `isValidTimezone` rejects anything that is not a real IANA id (e.g. `Asia/Dubai`);
  validation and activation both enforce it.
- `computeNextRun(schedule, tz, after)` walks candidate local days forward (building
  each at local noon to avoid DST gaps) until it finds the first wall-clock instant
  strictly **after** `after`. It supports `once` / `daily` / `weekly` / `monthly`.

Because "09:00 in `Asia/Dubai`" is resolved against the live zone offset each time, a
daily schedule keeps firing at the intended local hour across DST changes rather than
drifting by an hour.

### Monthly edge cases (day 31)

A `monthly` schedule for **day 31** is **clamped to the month's last day** — so it
fires on Feb 28/29, Apr 30, etc., rather than skipping short months
(`Math.min(schedule.day, daysInMonth(...))`).

## nextRunAt recomputation

`nextRunAt` is recomputed **deterministically** — never from a wall-clock timer —
whenever the schedule could have changed:

- on **create / edit** (timezone or schedule change), **activate**, **pause**,
  **resume**, and **after every run** (`recomputeNextRun` / `afterRun`);
- inside a tick, right after claiming, so the just-fired instant is not re-selected.

A workflow only has a `nextRunAt` while it is `ACTIVE` with an enabled schedule/condition
trigger; pausing or archiving sets it to null. For a `CONDITION` trigger, the next
check is simply `now + checkIntervalMinutes`.

## Missed-run policy (downtime catch-up)

If the worker was down and several instants elapsed, catch-up is **conservative**. The
trigger's `missedRunPolicy` is one of:

- **SKIP** — ignore missed instants; resume at the next future one.
- **RUN_ONCE_WHEN_RECOVERED** (default) — run a single catch-up, then resume normally.
- **CATCH_UP_LIMITED** — run at most `WORKFLOW_MAX_CATCHUP_RUNS` (default **1**) missed
  instants.

The platform never floods a recovered workflow with a backlog of runs.

## Stuck-run recovery & heartbeat

A run writes `startedAt` + `heartbeatAt` when it claims execution. If a worker dies
mid-run, the row would otherwise sit in `RUNNING` forever. On each tick,
`recoverStuckRuns` marks any run whose `heartbeatAt` is older than
`WORKFLOW_STUCK_TIMEOUT_MS` (default **600000** = 10 min) as `FAILED` with
`errorCode='INTERNAL_ERROR'`.

Recovery is **read-safe, not write-optimistic**: there is **no automatic retry of a
recovered run**. Because a write's outcome at the moment of death is unknown, silently
re-running could double-send. A recovered run is failed and surfaced; a human decides
whether to run it again. (Consecutive-failure tracking may then AUTO_PAUSE the workflow.)

## Scheduler health

`GET /api/admin/automations` surfaces scheduler health as metadata: the kill-switch
states, run counts, **queue depth** (`QUEUED` runs), and **overdue** count (ACTIVE
workflows whose `nextRunAt` is more than 5 minutes in the past) — a signal that the
worker may not be ticking. No workflow content, arguments, or recipients are exposed.

## Deployment note

Two moving parts, no new **paid** infrastructure auto-provisioned:

- the **web app** (`apps/web`), which serves `/api/internal/workflows/tick`; and
- a **scheduler/worker** that calls that endpoint about once per minute with the
  shared secret — an external cron, a platform scheduled job, or a tiny always-on
  process. Any of these works because the endpoint is stateless and idempotent.

To enable scheduling in an environment you set `WORKFLOW_TICK_SECRET` (without it the
endpoint stays 503) and point a durable trigger at the tick URL. No queue service,
managed scheduler, or other paid resource is provisioned automatically — provisioning
real infrastructure is a deliberate, human-approved step. Multiple workers are safe
(the unique run key dedupes), so the tick can be run redundantly for availability.

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `WORKFLOWS_ENABLED` | `true` | Master kill switch; `false` stops all workflow execution. |
| `WORKFLOW_SCHEDULER_ENABLED` | `true` | `false` stops scheduled/condition runs (manual still allowed). |
| `WORKFLOW_MIN_CHECK_INTERVAL_MINUTES` | `15` | Floor on condition-poll interval (no second-by-second polling). |
| `WORKFLOW_MAX_CATCHUP_RUNS` | `1` | Missed-instant catch-up cap after downtime. |
| `WORKFLOW_STUCK_TIMEOUT_MS` | `600000` | Recover runs stuck in `RUNNING` past this heartbeat age. |
| `WORKFLOW_TICK_SECRET` | *(unset)* | Shared secret to call the tick endpoint; **unset = tick disabled (503)**. |

See [`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md) for the full kill-switch chain
and the tick endpoint's trust model.
