import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflows, workflowVersions, workflowTriggers } from '@/server/db/schema';
import type { Workflow, WorkflowTrigger } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';
import { isOrgManager } from '@/server/auth/permissions';
import { writeAudit } from '@/server/ai/audit';
import { computeNextRun, type Schedule } from './schedule';

/**
 * Workflow persistence + tenant-isolated access + versioning.
 *
 * A PERSONAL workflow belongs to its owner alone; an ORGANIZATION workflow belongs
 * to the ORG (not the creator) and is manageable only by an org manager in that
 * org's active workspace. Configuration and runtime state are kept strictly
 * separate — runs never mutate the workflow row except its scheduling bookkeeping.
 */

export interface WorkflowAccess {
  workflow: Workflow;
  canManage: boolean;
}

export async function resolveWorkflowAccess(userId: string, workflowId: string, activeOrganizationId: string | null): Promise<WorkflowAccess | null> {
  const [wf] = await getDb().select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!wf) return null;
  if (wf.ownerType === 'PERSONAL') {
    if (wf.userId !== userId) return null;
    return { workflow: wf, canManage: true };
  }
  // ORGANIZATION: must be the active workspace + a verified member; managers manage.
  if (!wf.organizationId || wf.organizationId !== activeOrganizationId) return null;
  const ctx = await resolveOrgContextById(userId, wf.organizationId);
  if (!ctx) return null;
  return { workflow: wf, canManage: isOrgManager(ctx.role) };
}

export async function listWorkflowsForScope(scope: { userId: string; organizationId: string | null }): Promise<Workflow[]> {
  const where = scope.organizationId
    ? and(eq(workflows.ownerType, 'ORGANIZATION'), eq(workflows.organizationId, scope.organizationId))
    : and(eq(workflows.ownerType, 'PERSONAL'), eq(workflows.userId, scope.userId), isNull(workflows.organizationId));
  return getDb().select().from(workflows).where(where).orderBy(desc(workflows.createdAt));
}

export async function getTrigger(workflowId: string): Promise<WorkflowTrigger | null> {
  const [t] = await getDb().select().from(workflowTriggers).where(eq(workflowTriggers.workflowId, workflowId)).limit(1);
  return t ?? null;
}

/** Snapshot the current config into a version row + bump the version hash. */
export async function snapshotVersion(wf: Workflow, actorUserId: string): Promise<void> {
  const snapshot = {
    name: wf.name,
    goal: wf.goal,
    triggerType: wf.triggerType,
    approvalPolicy: wf.approvalPolicy,
    timezone: wf.timezone,
    knowledgeBaseIds: wf.knowledgeBaseIds,
    connectionIds: wf.connectionIds,
    webSearchEnabled: wf.webSearchEnabled,
    maxSteps: wf.maxSteps,
    maxToolCalls: wf.maxToolCalls,
    maxWritesPerRun: wf.maxWritesPerRun,
  };
  const configHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 32);
  await getDb()
    .insert(workflowVersions)
    .values({ workflowId: wf.id, version: wf.version, snapshot, configHash, createdByUserId: actorUserId })
    .onConflictDoNothing();
}

/** Recompute nextRunAt deterministically after create/edit/run/pause/resume/tz change. */
export async function recomputeNextRun(workflowId: string): Promise<Date | null> {
  const [wf] = await getDb().select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!wf) return null;
  const trigger = await getTrigger(workflowId);
  let next: Date | null = null;
  if (wf.status === 'ACTIVE' && trigger?.enabled && (trigger.type === 'SCHEDULE' || trigger.type === 'CONDITION')) {
    if (trigger.type === 'SCHEDULE' && trigger.schedule) {
      next = computeNextRun(trigger.schedule as Schedule, wf.timezone);
    } else if (trigger.type === 'CONDITION' && trigger.checkIntervalMinutes) {
      next = new Date(Date.now() + trigger.checkIntervalMinutes * 60_000);
    }
  }
  await getDb().update(workflows).set({ nextRunAt: next, updatedAt: new Date() }).where(eq(workflows.id, workflowId));
  return next;
}

export async function setWorkflowStatus(workflowId: string, status: Workflow['status'], actorUserId: string): Promise<void> {
  await getDb().update(workflows).set({ status, updatedAt: new Date() }).where(eq(workflows.id, workflowId));
  await writeAudit({ adminUserId: actorUserId, action: `workflow.${status.toLowerCase()}`, targetType: 'workflow', targetId: workflowId, newValue: { status } });
  await recomputeNextRun(workflowId);
}

export async function bumpConsecutiveFailures(workflowId: string, reset: boolean): Promise<number> {
  if (reset) {
    await getDb().update(workflows).set({ consecutiveFailures: 0, updatedAt: new Date() }).where(eq(workflows.id, workflowId));
    return 0;
  }
  const [row] = await getDb()
    .update(workflows)
    .set({ consecutiveFailures: sql`${workflows.consecutiveFailures} + 1`, updatedAt: new Date() })
    .where(eq(workflows.id, workflowId))
    .returning({ n: workflows.consecutiveFailures });
  return row?.n ?? 0;
}

export async function getWorkflow(workflowId: string): Promise<Workflow | null> {
  const [wf] = await getDb().select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  return wf ?? null;
}
