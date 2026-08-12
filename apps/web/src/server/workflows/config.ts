/**
 * Workflow platform configuration + kill switches. Platform HARD limits always
 * override per-workflow settings. Kill switches are server-controlled feature
 * flags that stop execution safely without deleting anything.
 */

/** Master switch — false stops ALL workflow execution (new + scheduled). */
export function workflowsEnabled(): boolean {
  return process.env.WORKFLOWS_ENABLED !== 'false';
}

/** Scheduler switch — false stops scheduled/condition runs (manual still allowed). */
export function schedulerEnabled(): boolean {
  return process.env.WORKFLOW_SCHEDULER_ENABLED !== 'false';
}

export function conditionTriggersEnabled(): boolean {
  return process.env.WORKFLOW_CONDITION_TRIGGERS_ENABLED !== 'false';
}

/**
 * Scheduled external writes — SEPARATE from Phase 11's agent write switch and OFF
 * by default. Scheduled read workflows keep working while scheduled writes are
 * globally disabled.
 */
export function scheduledWritesEnabled(): boolean {
  return process.env.WORKFLOW_SCHEDULED_WRITES_ENABLED === 'true';
}

/** Per-tool automation kill switch, e.g. WORKFLOW_DISABLED_TOOLS="gmail.send". */
export function toolDisabledInWorkflows(toolId: string): boolean {
  return (process.env.WORKFLOW_DISABLED_TOOLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(toolId);
}

/** Hard ceilings the platform enforces regardless of workflow/plan config. */
export function hardMaxSteps(): number {
  const n = Number(process.env.WORKFLOW_MAX_HARD_STEPS);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

/** Minimum allowed condition-poll interval (minutes) — no second-by-second polling. */
export function minCheckIntervalMinutes(): number {
  const n = Number(process.env.WORKFLOW_MIN_CHECK_INTERVAL_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

/** How many missed scheduled instants to run after downtime (CATCH_UP_LIMITED). */
export function maxCatchUpRuns(): number {
  const n = Number(process.env.WORKFLOW_MAX_CATCHUP_RUNS);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** A stuck RUNNING run older than this (ms) may be recovered by the scheduler. */
export function stuckRunTimeoutMs(): number {
  const n = Number(process.env.WORKFLOW_STUCK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 10 * 60_000;
}
