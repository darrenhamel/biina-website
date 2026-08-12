import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { workflows, workflowTriggers } from '@/server/db/schema';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { updateWorkflowSchema } from '@/lib/validation';
import { handleError, ok, notFound, forbidden } from '@/lib/api';
import { logSecurityEvent } from '@/server/auth/events';
import { resolveWorkflowAccess, getTrigger, snapshotVersion, recomputeNextRun } from '@/server/workflows/store';
import { activationSummary } from '@/server/workflows/compiler';
import { listRuns } from '@/server/workflows/runs';
import { listStandingAuthorizations } from '@/server/workflows/standing-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Workflow not found');
    const trigger = await getTrigger(params.id);
    const plan = await getPlan(auth.user.plan);
    const [runs, auths] = await Promise.all([listRuns(params.id, 10), listStandingAuthorizations(auth.user.id, params.id)]);
    const w = access.workflow;
    return ok({
      workflow: {
        id: w.id, name: w.name, description: w.description, goal: w.goal, status: w.status, ownerType: w.ownerType,
        triggerType: w.triggerType, agentMode: w.agentMode, approvalPolicy: w.approvalPolicy, timezone: w.timezone,
        knowledgeBaseIds: w.knowledgeBaseIds, connectionIds: w.connectionIds, webSearchEnabled: w.webSearchEnabled,
        maxSteps: w.maxSteps, maxWritesPerRun: w.maxWritesPerRun, maxRunsPerMonth: w.maxRunsPerMonth,
        notifyOnSuccess: w.notifyOnSuccess, notifyOnFailure: w.notifyOnFailure, nextRunAt: w.nextRunAt, lastRunAt: w.lastRunAt,
      },
      trigger: trigger ? { type: trigger.type, schedule: trigger.schedule, timezone: trigger.timezone, checkIntervalMinutes: trigger.checkIntervalMinutes } : null,
      activationSummary: activationSummary(w, trigger, plan),
      canManage: access.canManage,
      runs: runs.map((r) => ({ id: r.id, status: r.status, trigger: r.triggerType, writeActions: r.writeActions, createdAt: r.createdAt, completedAt: r.completedAt, resultSummary: r.resultSummary })),
      standingAuthorizations: auths.map((a) => ({ id: a.id, toolId: a.toolId, destinations: a.allowedDestinations, status: a.status, expiresAt: a.expiresAt, executionsUsed: a.executionsUsed, maxExecutions: a.maxExecutions })),
    });
  } catch (err) {
    return handleError(err, 'workflows.detail');
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Workflow not found');
    if (!access.canManage) return forbidden('You cannot edit this workflow.');
    const patch = updateWorkflowSchema.parse(await req.json());

    // Bump version + snapshot the PRIOR config before applying edits.
    await snapshotVersion(access.workflow, auth.user.id);
    const set: Record<string, unknown> = { updatedAt: new Date(), version: access.workflow.version + 1 };
    for (const k of ['name', 'description', 'goal', 'agentMode', 'approvalPolicy', 'timezone', 'knowledgeBaseIds', 'connectionIds', 'webSearchEnabled', 'maxSteps', 'maxToolCalls', 'maxWritesPerRun', 'maxCostPerRun', 'maxRunsPerDay', 'maxRunsPerMonth', 'notifyOnSuccess', 'notifyOnFailure'] as const) {
      if (patch[k] !== undefined) set[k] = patch[k];
    }
    await getDb().update(workflows).set(set).where(eq(workflows.id, params.id));
    if (patch.trigger) {
      await getDb().update(workflowTriggers).set({ type: patch.trigger.type, schedule: patch.trigger.schedule ?? null, timezone: patch.trigger.timezone ?? access.workflow.timezone, conditionType: patch.trigger.conditionType ?? null, checkIntervalMinutes: patch.trigger.checkIntervalMinutes ?? null, missedRunPolicy: patch.trigger.missedRunPolicy ?? 'RUN_ONCE_WHEN_RECOVERED', updatedAt: new Date() }).where(eq(workflowTriggers.workflowId, params.id));
      await getDb().update(workflows).set({ triggerType: patch.trigger.type }).where(eq(workflows.id, params.id));
    }
    const nextRunAt = await recomputeNextRun(params.id); // deterministic reschedule after edit / tz change
    await logSecurityEvent({ event: 'workflow.updated', userId: auth.user.id, actorUserId: auth.user.id, organizationId: ws.organizationId, metadata: { workflowId: params.id } });
    return ok({ ok: true, nextRunAt });
  } catch (err) {
    return handleError(err, 'workflows.update');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveWorkflowAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Workflow not found');
    if (!access.canManage) return forbidden('You cannot delete this workflow.');
    // Archive (never hard-delete casually) + stop scheduling.
    await getDb().update(workflows).set({ status: 'ARCHIVED', nextRunAt: null, updatedAt: new Date() }).where(eq(workflows.id, params.id));
    await logSecurityEvent({ event: 'workflow.archived', userId: auth.user.id, actorUserId: auth.user.id, organizationId: ws.organizationId, metadata: { workflowId: params.id } });
    return ok({ ok: true, status: 'ARCHIVED' });
  } catch (err) {
    return handleError(err, 'workflows.archive');
  }
}
