import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflowRuns, workflows as workflowsTable, users } from '@/server/db/schema';
import type { Workflow, WorkflowRun } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { logSecurityEvent } from '@/server/auth/events';
import type { RouteContext } from '@/server/ai/routing';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { getPlan } from '@/server/ai/plans';
import { createSession, getSession, getAction } from '@/server/agent/sessions';
import { advanceAgentSession, resumeAfterApproval, type AgentRunResult, type RunContext } from '@/server/agent/orchestrator';
import { decideApproval, getApproval } from '@/server/agent/approvals';
import { getAgentTool } from '@/server/agent/tool-catalog';
import { hardMaxSteps, scheduledWritesEnabled, toolDisabledInWorkflows } from './config';
import { getWorkflow, getTrigger, recomputeNextRun, bumpConsecutiveFailures, setWorkflowStatus } from './store';
import { checkRunnable } from './quotas';
import { matchStandingAuthorization, consumeStandingAuthorization } from './standing-auth';
import { notify } from './notifications';

/**
 * WorkflowRunner — the single boundary that turns a queued WorkflowRun into a
 * Phase 11 agent run. It performs LIVE authorization rechecks, builds an
 * AgentSession, and drives AgentOrchestrator. Every proposed write pauses for
 * approval exactly as in Phase 11; the ONLY way a scheduled write proceeds without
 * a human is a matching, unexpired, in-limit standing authorization (consumed
 * atomically). Nothing here can grant new permissions.
 */

const MAX_AUTO_APPROVALS_HARD = 5;

/** Substitute safe workflow variables into the goal (no arbitrary scripting). */
function renderGoal(workflow: Workflow, orgName: string | null): string {
  const now = new Date();
  return workflow.goal
    .replaceAll('{{currentDate}}', now.toISOString().slice(0, 10))
    .replaceAll('{{workflowName}}', workflow.name)
    .replaceAll('{{organizationName}}', orgName ?? '')
    .replaceAll('{{triggerTime}}', now.toISOString());
}

async function claimStart(run: WorkflowRun): Promise<void> {
  await getDb().update(workflowRuns).set({ status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date() }).where(eq(workflowRuns.id, run.id));
}

async function finalizeRun(run: WorkflowRun, workflow: Workflow, status: WorkflowRun['status'], summary: string, errorCode?: string): Promise<void> {
  const session = run.agentSessionId ? await getSession(run.agentSessionId) : null;
  await getDb()
    .update(workflowRuns)
    .set({
      status,
      resultSummary: summary.slice(0, 1000),
      errorCode: errorCode ?? null,
      errorSummary: errorCode ? summary.slice(0, 400) : null,
      stepsExecuted: session?.stepsUsed ?? 0,
      toolCalls: session?.toolCallsUsed ?? 0,
      writeActions: session?.writeActionsUsed ?? 0,
      estimatedCost: session?.estimatedCost ?? 0,
      completedAt: new Date(),
    })
    .where(eq(workflowRuns.id, run.id));

  // Consecutive-failure tracking → auto-pause.
  const isFailure = status === 'FAILED' || status === 'BLOCKED';
  if (isFailure) {
    const n = await bumpConsecutiveFailures(workflow.id, false);
    if (workflow.maxConsecutiveFailures > 0 && n >= workflow.maxConsecutiveFailures && workflow.status === 'ACTIVE') {
      await setWorkflowStatus(workflow.id, 'AUTO_PAUSED', workflow.createdByUserId ?? workflow.userId ?? '');
      await logSecurityEvent({ event: 'workflow.auto_paused', userId: workflow.userId, organizationId: workflow.organizationId, metadata: { workflowId: workflow.id, failures: n } });
      await notify({ userId: workflow.createdByUserId ?? workflow.userId!, organizationId: workflow.organizationId, workflowId: workflow.id, workflowRunId: run.id, kind: 'auto_paused', title: `Automation paused: ${workflow.name}`, body: `Paused after ${n} consecutive failures.`, dedupeKey: `autopause:${workflow.id}:${n}`, email: true });
    }
  } else if (status === 'COMPLETED') {
    await bumpConsecutiveFailures(workflow.id, true);
  }

  // Notifications per policy (deduped).
  const notifyUser = workflow.createdByUserId ?? workflow.userId;
  if (notifyUser) {
    if (isFailure && workflow.notifyOnFailure) {
      await notify({ userId: notifyUser, organizationId: workflow.organizationId, workflowId: workflow.id, workflowRunId: run.id, kind: 'failure', title: `Automation failed: ${workflow.name}`, body: summary, dedupeKey: `fail:${run.id}`, email: true });
    } else if (status === 'AWAITING_APPROVAL') {
      await notify({ userId: notifyUser, organizationId: workflow.organizationId, workflowId: workflow.id, workflowRunId: run.id, kind: 'approval_needed', title: `Approval needed: ${workflow.name}`, body: summary, dedupeKey: `approve:${run.id}` });
    } else if (status === 'COMPLETED' && workflow.notifyOnSuccess !== 'NEVER') {
      await notify({ userId: notifyUser, organizationId: workflow.organizationId, workflowId: workflow.id, workflowRunId: run.id, kind: 'result', title: `Automation complete: ${workflow.name}`, body: summary, dedupeKey: `done:${run.id}` });
    }
  }

  await logSecurityEvent({ event: status === 'COMPLETED' ? 'workflow.run_completed' : status === 'FAILED' ? 'workflow.run_failed' : status === 'BLOCKED' ? 'workflow.run_blocked' : 'workflow.run_started', userId: workflow.userId, organizationId: workflow.organizationId, metadata: { workflowId: workflow.id, runId: run.id, status } });
}

/** Build a RunContext for the workflow's execution identity. */
async function buildRunContext(run: WorkflowRun, workflow: Workflow, planSlug: string, executingUserId: string, signal?: AbortSignal): Promise<RunContext | null> {
  const [u] = await getDb().select().from(users).where(eq(users.id, executingUserId)).limit(1);
  if (!u) return null;
  const plan = await getPlan(planSlug);
  const maxSteps = Math.min(workflow.maxSteps, plan.maxWorkflowSteps ?? hardMaxSteps(), hardMaxSteps());
  const goal = renderGoal(workflow, null);
  const session = await createSession({
    userId: executingUserId,
    organizationId: workflow.organizationId,
    conversationId: null,
    mode: workflow.agentMode,
    goal,
    maxSteps,
    costBudget: workflow.maxCostPerRun ?? null,
    currency: 'USD',
    dryRun: run.dryRun,
    deadlineAt: new Date(Date.now() + 120_000),
  });
  await getDb().update(workflowRuns).set({ agentSessionId: session.id }).where(eq(workflowRuns.id, run.id));
  const routeContext: RouteContext = { userId: executingUserId, userPlan: u.plan, isAdmin: isPlatformAdmin(u.role), persona: null, organizationId: workflow.organizationId, organizationRole: null };
  return { session, userId: executingUserId, organizationId: workflow.organizationId, planSlug, plan, routeContext, signal };
}

/**
 * Drive the agent session, auto-approving ONLY writes covered by a valid standing
 * authorization. Returns the terminal AgentRunResult (COMPLETED / AWAITING_APPROVAL
 * / BLOCKED / FAILED). Bounded by maxWritesPerRun.
 */
async function driveSession(rc: RunContext, workflow: Workflow, isScheduled: boolean): Promise<AgentRunResult> {
  let result = await advanceAgentSession(rc);
  const cap = Math.min(workflow.maxWritesPerRun, MAX_AUTO_APPROVALS_HARD);
  let autoApprovals = 0;

  while (result.status === 'AWAITING_APPROVAL' && result.actionId) {
    const action = await getAction(result.actionId);
    if (!action) break;
    const tool = getAgentTool(action.toolId);
    if (!tool) break;

    // Scheduled writes have an extra global kill switch + per-tool automation switch.
    if (isScheduled && (!scheduledWritesEnabled() || toolDisabledInWorkflows(tool.id))) {
      return { status: 'BLOCKED', message: `Scheduled write ${tool.id} is disabled; a person must run/approve this.` };
    }
    // READ_ONLY_AUTOMATIC never auto-runs a write. ASK_EVERY_WRITE + ASK_HIGH_RISK_ONLY
    // still require an explicit standing authorization to proceed unattended.
    if (workflow.approvalPolicy === 'READ_ONLY_AUTOMATIC') break;
    if (autoApprovals >= cap) break;

    const approval = await getApproval(result.approval!.id);
    if (!approval) break;
    const auth = await matchStandingAuthorization({ workflowId: workflow.id, userId: rc.userId, organizationId: rc.organizationId, tool, args: (action.normalizedArguments ?? {}) as Record<string, unknown>, connectionId: action.connectionId! });
    if (!auth) break; // no standing authorization → needs a human

    if (!(await consumeStandingAuthorization(auth.id))) break; // over limit → needs a human
    await logSecurityEvent({ event: 'workflow.standing_auth_used', userId: rc.userId, organizationId: rc.organizationId, metadata: { workflowId: workflow.id, toolId: tool.id, authId: auth.id } });

    await decideApproval({ approvalId: approval.id, decidedByUserId: rc.userId, decision: 'APPROVED', organizationId: rc.organizationId });
    const freshSession = await getSession(rc.session.id);
    const actionRow = await getAction(action.id);
    const approvalRow = await getApproval(approval.id);
    result = await resumeAfterApproval({ ...rc, session: freshSession! }, actionRow!, approvalRow!);
    autoApprovals += 1;
  }
  return result;
}

function mapStatus(agent: AgentRunResult['status']): WorkflowRun['status'] {
  switch (agent) {
    case 'COMPLETED': return 'COMPLETED';
    case 'AWAITING_APPROVAL': return 'AWAITING_APPROVAL';
    case 'BLOCKED': return 'BLOCKED';
    case 'CANCELED': return 'CANCELED';
    default: return 'FAILED';
  }
}

/** Execute a queued workflow run end-to-end (used by scheduler, run-now, dry-run). */
export async function executeWorkflowRun(runId: string, opts: { signal?: AbortSignal } = {}): Promise<WorkflowRun['status']> {
  const [run] = await getDb().select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
  if (!run) return 'FAILED';
  const workflow = await getWorkflow(run.workflowId);
  if (!workflow) { await finalizeRun(run, { id: run.workflowId } as Workflow, 'FAILED', 'Workflow not found', 'INTERNAL_ERROR'); return 'FAILED'; }
  const trigger = await getTrigger(workflow.id);
  const isScheduled = run.triggerType === 'SCHEDULE' || run.triggerType === 'CONDITION';

  const plan = await getPlan(workflow.createdByUserId ? (await planSlugOf(workflow.createdByUserId)) : 'FREE');
  const runnable = await checkRunnable(workflow, plan, isScheduled);
  if (!runnable.ok) {
    await finalizeRun(run, workflow, runnable.reason === 'QUOTA_EXCEEDED' ? 'SKIPPED' : 'BLOCKED', runnable.message ?? 'Not runnable', runnable.reason);
    await afterRun(workflow);
    return runnable.reason === 'QUOTA_EXCEEDED' ? 'SKIPPED' : 'BLOCKED';
  }

  await claimStart(run);
  await logSecurityEvent({ event: 'workflow.run_started', userId: workflow.userId, organizationId: workflow.organizationId, metadata: { workflowId: workflow.id, runId: run.id, trigger: run.triggerType } });

  const rc = await buildRunContext(run, workflow, runnable.planSlug, runnable.executingUserId, opts.signal);
  if (!rc) { await finalizeRun(run, workflow, 'FAILED', 'Could not build execution context', 'INTERNAL_ERROR'); await afterRun(workflow); return 'FAILED'; }

  let final: AgentRunResult;
  try {
    final = await driveSession(rc, workflow, isScheduled);
  } catch (err) {
    logger.error('workflow.run.error', { runId, error: String(err) });
    await finalizeRun({ ...run, agentSessionId: rc.session.id }, workflow, 'FAILED', 'Run error', classifyError(String(err)));
    await afterRun(workflow);
    return 'FAILED';
  }

  const status = mapStatus(final.status);
  await finalizeRun({ ...run, agentSessionId: rc.session.id }, workflow, status, final.message ?? status);
  await afterRun(workflow);
  return status;
}

/** Human approval/rejection of a paused workflow run → continue the runner loop. */
export async function resumeWorkflowRunAfterDecision(input: {
  run: WorkflowRun;
  workflow: Workflow;
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  actorUserId: string;
  organizationId: string | null;
}): Promise<WorkflowRun['status']> {
  const { run, workflow } = input;
  const approval = await getApproval(input.approvalId);
  if (!approval || !run.agentSessionId) return run.status;
  await decideApproval({ approvalId: input.approvalId, decidedByUserId: input.actorUserId, decision: input.decision, organizationId: input.organizationId });

  const plan = await getPlan(await planSlugOf(input.actorUserId));
  const session = await getSession(run.agentSessionId);
  const [u] = await getDb().select().from(users).where(eq(users.id, input.actorUserId)).limit(1);
  const routeContext: RouteContext = { userId: input.actorUserId, userPlan: u!.plan, isAdmin: isPlatformAdmin(u!.role), persona: null, organizationId: input.organizationId, organizationRole: null };
  const rc: RunContext = { session: session!, userId: input.actorUserId, organizationId: input.organizationId, planSlug: plan.slug, plan, routeContext };

  let final: AgentRunResult;
  if (input.decision === 'REJECTED') {
    final = await advanceAgentSession(rc); // agent adapts/stops
  } else {
    const action = await getAction(approval.actionId);
    final = await resumeAfterApproval(rc, action!, approval);
    // Continue auto-driving any further standing-auth-covered writes.
    if (final.status === 'AWAITING_APPROVAL') final = await driveSession({ ...rc, session: (await getSession(run.agentSessionId))! }, workflow, run.triggerType !== 'MANUAL');
  }
  const status = mapStatus(final.status);
  await finalizeRun(run, workflow, status, final.message ?? status);
  await afterRun(workflow);
  return status;
}

async function afterRun(workflow: Workflow): Promise<void> {
  await getDb().update(workflowsTable).set({ lastRunAt: new Date() }).where(eq(workflowsTable.id, workflow.id));
  await recomputeNextRun(workflow.id);
}

async function planSlugOf(userId: string): Promise<string> {
  const [u] = await getDb().select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.plan ?? 'FREE';
}

function classifyError(msg: string): string {
  if (/reauth|401|unauthor/i.test(msg)) return 'AUTH_ERROR';
  if (/403|permission|forbidden/i.test(msg)) return 'PERMISSION_ERROR';
  if (/quota/i.test(msg)) return 'QUOTA_ERROR';
  if (/budget/i.test(msg)) return 'BUDGET_ERROR';
  if (/connector|provider/i.test(msg)) return 'CONNECTOR_ERROR';
  if (/model/i.test(msg)) return 'MODEL_ERROR';
  return 'INTERNAL_ERROR';
}
