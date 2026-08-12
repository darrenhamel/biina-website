import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflows, workflowRuns, users } from '@/server/db/schema';
import type { Plan, Workflow } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';
import { workflowsEnabled } from './config';

/**
 * Workflow entitlement + LIVE runnability checks. A workflow's authority is
 * re-derived every run — never assumed from creation time. This gate covers:
 * kill switch, plan entitlement, owner/org active + membership, run quota.
 */

export type RunBlockReason =
  | 'KILL_SWITCH'
  | 'NOT_ENTITLED'
  | 'SCHEDULED_DISABLED'
  | 'USER_SUSPENDED'
  | 'ORG_SUSPENDED'
  | 'NOT_A_MEMBER'
  | 'QUOTA_EXCEEDED'
  | 'MAX_ACTIVE_WORKFLOWS';

export interface RunnableResult {
  ok: boolean;
  reason?: RunBlockReason;
  message?: string;
  executingUserId: string;
  planSlug: string;
}

/** Re-validate that a workflow may run RIGHT NOW under live authority. */
export async function checkRunnable(workflow: Workflow, plan: Plan, isScheduled: boolean): Promise<RunnableResult> {
  const executingUserId = workflow.createdByUserId ?? workflow.userId ?? '';
  const base = { executingUserId, planSlug: 'FREE' };
  if (!workflowsEnabled()) return { ok: false, reason: 'KILL_SWITCH', message: 'Workflows are disabled.', ...base };
  if (!plan.workflowsEnabled) return { ok: false, reason: 'NOT_ENTITLED', message: 'Your plan does not include workflows.', ...base, planSlug: plan.slug };
  if (isScheduled && !plan.scheduledAutomationsEnabled) return { ok: false, reason: 'SCHEDULED_DISABLED', message: 'Your plan does not include scheduled automations.', ...base, planSlug: plan.slug };

  // Owner/organization must be live. A suspended user/org halts execution.
  if (workflow.ownerType === 'PERSONAL') {
    const [u] = await getDb().select({ status: users.status }).from(users).where(eq(users.id, workflow.userId!)).limit(1);
    if (!u || u.status !== 'ACTIVE') return { ok: false, reason: 'USER_SUSPENDED', message: 'The workflow owner is not active.', ...base, planSlug: plan.slug };
  } else {
    // Organization workflow executes under the creator's verified membership + an ACTIVE org.
    const ctx = await resolveOrgContextById(executingUserId, workflow.organizationId!);
    if (!ctx) return { ok: false, reason: 'NOT_A_MEMBER', message: 'The execution identity is no longer a member.', ...base, planSlug: plan.slug };
    if (ctx.org.status !== 'ACTIVE') return { ok: false, reason: 'ORG_SUSPENDED', message: 'The organization is suspended.', ...base, planSlug: plan.slug };
  }

  // Monthly run quota (plan + per-workflow).
  const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  if (plan.workflowRunsPerMonth != null) {
    const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(workflowRuns).where(and(eq(workflowRuns.workflowId, workflow.id), gte(workflowRuns.createdAt, month)));
    if ((r?.n ?? 0) >= plan.workflowRunsPerMonth) return { ok: false, reason: 'QUOTA_EXCEEDED', message: 'Monthly workflow-run limit reached.', executingUserId, planSlug: plan.slug };
  }
  if (workflow.maxRunsPerMonth != null) {
    const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(workflowRuns).where(and(eq(workflowRuns.workflowId, workflow.id), gte(workflowRuns.createdAt, month)));
    if ((r?.n ?? 0) >= workflow.maxRunsPerMonth) return { ok: false, reason: 'QUOTA_EXCEEDED', message: 'This workflow reached its monthly run limit.', executingUserId, planSlug: plan.slug };
  }
  return { ok: true, executingUserId, planSlug: plan.slug };
}

/** Enforce max active workflows on activation. */
export async function assertUnderActiveWorkflowLimit(scope: { userId: string; organizationId: string | null }, plan: Plan): Promise<void> {
  if (plan.maxActiveWorkflows == null) return;
  const where = scope.organizationId ? and(eq(workflows.organizationId, scope.organizationId), eq(workflows.status, 'ACTIVE')) : and(eq(workflows.userId, scope.userId), eq(workflows.status, 'ACTIVE'));
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(workflows).where(where);
  if ((r?.n ?? 0) >= plan.maxActiveWorkflows) {
    throw Object.assign(new Error('Active workflow limit reached for your plan.'), { status: 403, code: 'max_active_workflows' });
  }
}
