# BIINA.ai — Workflow Runbook

Operating the workflow scheduler and runs (Phase 12+). Every procedure follows
**detect → act → verify**.

On-call: `<ops-oncall>` · Automation owner: `<automation-owner>`

See also: `docs/WORKFLOWS.md`, `docs/SCHEDULER.md`, `docs/WORKFLOW_APPROVALS.md`,
`docs/AUTOMATION_SECURITY.md`.

---

## 0. How the scheduler works (read first)

The scheduler is **DATABASE-authoritative** (`src/server/workflows/scheduler.ts`)
— **no in-memory timers**. An external cron/durable worker calls the worker
boundary once per minute:

```
POST /api/internal/workflows/tick
  header: x-workflow-tick-secret: $WORKFLOW_TICK_SECRET   (constant-time compared)
  header: x-worker-id: <worker-name>
```

If `WORKFLOW_TICK_SECRET` is unset the endpoint returns `503` and never fires
(cannot be called anonymously). Each `tick()`:

1. **Recovers stuck runs** — any `RUNNING` past `WORKFLOW_STUCK_TIMEOUT_MS`
   (default 10 min, tracked by `heartbeatAt`) is marked `FAILED`
   (`errorCode: INTERNAL_ERROR`). **No automatic write retry.**
2. **Selects due** ACTIVE workflows (`nextRunAt <= now`, trigger `SCHEDULE`/`CONDITION`).
3. **Claims** each due instant by inserting a `workflowRuns` row with a UNIQUE
   `(workflowId, runKey)` (`runKey` derived from the scheduled instant) using
   `ON CONFLICT DO NOTHING` — whichever worker inserts first wins; a concurrent
   worker gets no row → `skippedDuplicates`. **This is how duplicate runs are
   prevented even with multiple workers.**
4. **Advances `nextRunAt`** (idempotent) so the instant isn't re-selected.
5. **Executes** the claimed run.

Kill switches / limits (`src/server/workflows/config.ts`):

| Flag / limit | Env | Default |
|---|---|---|
| All workflows | `WORKFLOWS_ENABLED` | on |
| Scheduler (scheduled/condition) | `WORKFLOW_SCHEDULER_ENABLED` | on |
| Condition triggers | `WORKFLOW_CONDITION_TRIGGERS_ENABLED` | on |
| Scheduled external writes | `WORKFLOW_SCHEDULED_WRITES_ENABLED` | **off** |
| Per-tool block | `WORKFLOW_DISABLED_TOOLS` | — |
| Hard max steps/run | `WORKFLOW_MAX_HARD_STEPS` | 20 |
| Min condition poll interval | `WORKFLOW_MIN_CHECK_INTERVAL_MINUTES` | 15 |
| Missed-run catch-up | `WORKFLOW_MAX_CATCHUP_RUNS` | 1 |
| Stuck-run timeout | `WORKFLOW_STUCK_TIMEOUT_MS` | 600000 (10m) |

---

## 1. Stuck jobs (runs hung in RUNNING)

**Detect** — runs stay `RUNNING` well past their expected duration; a worker died
mid-run.

**Act**
1. Ensure the tick is firing (§3). The **next tick auto-recovers** any run whose
   `heartbeatAt` is older than `WORKFLOW_STUCK_TIMEOUT_MS`, marking it `FAILED`.
2. To recover faster, lower `WORKFLOW_STUCK_TIMEOUT_MS` temporarily and let a tick
   run, or trigger a manual tick (§3).
3. Investigate the root cause (a hung external call, a slow tool). Recovery does
   **not** auto-retry writes — a partially-completed write must be reviewed by a
   human before any manual re-run.

**Verify** — the run moves to `FAILED`; no orphaned `RUNNING` rows past the
timeout; the underlying fault is fixed.

---

## 2. Duplicate-run prevention (verify run keys)

**Detect** — concern that a scheduled instant fired twice (e.g. two workers, or a
double cron).

**Act / Verify**
1. Confirm the design guard: `workflowRuns` has a UNIQUE `(workflowId, runKey)`;
   the second insert hits the conflict and is counted as `skippedDuplicates` in
   the tick result — it never executes.
2. If you see two **distinct** `runKey`s for what should be one instant, the
   scheduled-instant derivation or timezone is off — inspect the workflow's
   `timezone`/schedule and `nextRunAt`.
3. Safe to run **multiple workers** concurrently by design; the unique key is the
   arbiter. Do not add a second uncoordinated scheduler that bypasses the tick.

---

## 3. Scheduler outage + missed-run policy

**Detect** — no `workflow.tick` logs; workflows not firing; `nextRunAt` in the
past for many workflows.

**Act**
1. Confirm `WORKFLOW_TICK_SECRET` is set and the cron/worker is alive and
   reaching the app. Manual tick to test:
   ```bash
   curl -s -X POST https://<host>/api/internal/workflows/tick \
     -H "x-workflow-tick-secret: $WORKFLOW_TICK_SECRET" -H "x-worker-id: manual"
   ```
2. Restart the cron/worker (**REQUIRES INFRA**).
3. **Missed-run policy after downtime is conservative:** the scheduler does **not**
   fire every missed instant. It runs a **limited catch-up** — `WORKFLOW_MAX_CATCHUP_RUNS`
   (default **1**) — then advances `nextRunAt` forward. This prevents a "thundering
   herd" of backlogged runs after an outage. If you truly need more catch-up, raise
   the value deliberately and temporarily.

**Verify** — `workflow.tick` logs resume; due workflows fire once (not a backlog
storm); `nextRunAt` values are back in the future.

---

## 4. Mass pause (stop automations quickly)

**Detect** — a bad workflow template, runaway automation, or an incident requiring
all automation halted.

**Act** (least → most disruptive)
1. **Scheduled only:** `WORKFLOW_SCHEDULER_ENABLED=false` — manual runs still work.
2. **Everything:** `WORKFLOWS_ENABLED=false` — stops new + scheduled execution.
   `tick()` early-returns when either master switch is off.
3. **One tool everywhere:** `WORKFLOW_DISABLED_TOOLS="<tool.id>"`.
4. Restart the web/API tier to apply env changes.

**Verify** — `tick()` returns zero `claimed`; manual runs behave per the switch
you chose.

---

## 5. Write kill switch (stop external writes from automations)

Scheduled external writes are a **separate, default-OFF** switch from Phase 11's
agent write switch:

- `WORKFLOW_SCHEDULED_WRITES_ENABLED` (default **off**) — scheduled **read**
  workflows keep working while scheduled **writes** are globally disabled.
- Agent-side writes are additionally gated by `AGENT_WRITE_ACTIONS_ENABLED`
  (default off) — see `OPERATIONS_RUNBOOK.md` §8 and `COST_CONTROL_RUNBOOK.md`.

**Act** — to stop all automated external writes immediately: leave/ set
`WORKFLOW_SCHEDULED_WRITES_ENABLED` unset/false **and** `AGENT_WRITE_ACTIONS_ENABLED`
unset/false; optionally block a specific tool with `WORKFLOW_DISABLED_TOOLS`.

**Verify** — a scheduled workflow that would write is prevented/held; read
workflows still run.

---

## Do-not-do
- Never run a second, uncoordinated scheduler alongside the tick.
- Never auto-retry a partially-completed external write without human review.
- Never expose `/api/internal/workflows/tick` without `WORKFLOW_TICK_SECRET`.
