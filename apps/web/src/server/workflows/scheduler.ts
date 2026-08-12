import { and, eq, lte, lt, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflows, workflowRuns } from '@/server/db/schema';
import type { Workflow } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { schedulerEnabled, workflowsEnabled, stuckRunTimeoutMs } from './config';
import { getTrigger, recomputeNextRun } from './store';
import { computeNextRun, scheduledRunKey, type Schedule } from './schedule';
import { executeWorkflowRun } from './runner';

/**
 * WorkflowScheduler — the DATABASE is authoritative (no in-memory timers). An
 * authenticated worker calls `tick()` (e.g. once/minute from an external cron or a
 * durable worker process). Each tick: recovers stuck runs, claims due workflows
 * atomically, creates a run with a UNIQUE run key (so two workers can't double-fire
 * the same scheduled instant), advances nextRunAt, and executes the run. Missed
 * instants after downtime are handled conservatively (one catch-up run).
 */

export interface TickResult {
  claimed: number;
  executed: Array<{ workflowId: string; runId: string; status: string }>;
  recovered: number;
  skippedDuplicates: number;
}

/** Recover runs stuck in RUNNING beyond the timeout (dead worker). No write auto-retry. */
async function recoverStuckRuns(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - stuckRunTimeoutMs());
  const stuck = await getDb()
    .update(workflowRuns)
    .set({ status: 'FAILED', errorCode: 'INTERNAL_ERROR', errorSummary: 'Run exceeded its heartbeat timeout and was recovered.', completedAt: now })
    .where(and(eq(workflowRuns.status, 'RUNNING'), lt(workflowRuns.heartbeatAt, cutoff)))
    .returning({ id: workflowRuns.id });
  return stuck.length;
}

/** Select workflows whose scheduled instant is due (ACTIVE, scheduled, nextRunAt<=now). */
async function selectDue(now: Date): Promise<Workflow[]> {
  return getDb()
    .select()
    .from(workflows)
    .where(and(eq(workflows.status, 'ACTIVE'), lte(workflows.nextRunAt, now), inArray(workflows.triggerType, ['SCHEDULE', 'CONDITION'])))
    .limit(200);
}

export async function tick(workerId = 'tick'): Promise<TickResult> {
  const now = new Date();
  const result: TickResult = { claimed: 0, executed: [], recovered: 0, skippedDuplicates: 0 };
  if (!workflowsEnabled() || !schedulerEnabled()) return result;

  result.recovered = await recoverStuckRuns(now);
  const due = await selectDue(now);

  for (const wf of due) {
    const trigger = await getTrigger(wf.id);
    const scheduledFor = wf.nextRunAt ?? now; // the instant this run represents
    const runKey = scheduledRunKey(scheduledFor);

    // CLAIM via a UNIQUE (workflowId, runKey): whichever worker inserts first wins;
    // a concurrent worker hits the unique constraint and gets no row (no duplicate).
    let runId: string | null = null;
    try {
      const [run] = await getDb()
        .insert(workflowRuns)
        .values({ workflowId: wf.id, workflowVersion: wf.version, triggerType: wf.triggerType, userId: wf.userId, organizationId: wf.organizationId, status: 'QUEUED', runKey, scheduledFor, lockedBy: workerId, lockedAt: now })
        .onConflictDoNothing()
        .returning({ id: workflowRuns.id });
      runId = run?.id ?? null;
    } catch (e) {
      logger.warn('workflow.scheduler.create_failed', { workflowId: wf.id, error: String(e) });
    }

    // Advance nextRunAt (idempotent across workers) so this instant is not re-selected.
    let next: Date | null = null;
    if (trigger?.type === 'SCHEDULE' && trigger.schedule) next = computeNextRun(trigger.schedule as Schedule, wf.timezone, now);
    else if (trigger?.type === 'CONDITION' && trigger.checkIntervalMinutes) next = new Date(now.getTime() + trigger.checkIntervalMinutes * 60_000);
    await getDb().update(workflows).set({ nextRunAt: next, updatedAt: now }).where(eq(workflows.id, wf.id));

    if (!runId) {
      result.skippedDuplicates += 1;
      continue; // another worker already claimed this instant
    }
    result.claimed += 1;
    try {
      const status = await executeWorkflowRun(runId);
      result.executed.push({ workflowId: wf.id, runId, status });
    } catch (e) {
      logger.error('workflow.scheduler.execute_failed', { runId, error: String(e) });
    }
  }
  return result;
}

/** Recompute next run for a single workflow (used after edits). */
export async function reschedule(workflowId: string): Promise<Date | null> {
  return recomputeNextRun(workflowId);
}
