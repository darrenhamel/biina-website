import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflowRuns } from '@/server/db/schema';
import type { WorkflowRun, Workflow } from '@/server/db/schema';
import { listSteps } from '@/server/agent/sessions';
import { executeWorkflowRun } from './runner';

/**
 * Manual + dry-run creation and run-history reads. Manual runs still obey every
 * live check, policy, and approval gate — scheduling grants nothing here.
 */

/** Create + execute a manual (or dry) run immediately. */
export async function runNow(workflow: Workflow, opts: { dryRun: boolean }): Promise<{ run: WorkflowRun; status: WorkflowRun['status'] }> {
  const [run] = await getDb()
    .insert(workflowRuns)
    .values({ workflowId: workflow.id, workflowVersion: workflow.version, triggerType: 'MANUAL', userId: workflow.userId, organizationId: workflow.organizationId, status: 'QUEUED', runKey: `manual:${randomUUID()}`, dryRun: opts.dryRun })
    .returning();
  const status = await executeWorkflowRun(run.id);
  const [updated] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, run.id)).limit(1);
  return { run: updated ?? run, status };
}

export async function listRuns(workflowId: string, limit = 25): Promise<WorkflowRun[]> {
  return getDb().select().from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId)).orderBy(desc(workflowRuns.createdAt)).limit(limit);
}

export async function getRun(runId: string): Promise<WorkflowRun | null> {
  const [r] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  return r ?? null;
}

/** User-safe run detail: status + counters + the agent session's operational steps. */
export async function runDetail(run: WorkflowRun): Promise<{
  run: WorkflowRun;
  steps: Array<{ index: number; type: string; toolId: string | null; status: string; output: string | null }>;
}> {
  const steps = run.agentSessionId ? await listSteps(run.agentSessionId) : [];
  return {
    run,
    steps: steps.map((s) => ({ index: s.stepIndex, type: s.stepType, toolId: s.toolId, status: s.status, output: s.outputSummary })),
  };
}
