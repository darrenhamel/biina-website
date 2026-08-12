import type { Plan, ResearchSession, ResearchTask } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { logSecurityEvent } from '@/server/auth/events';
import { getProfile } from './profiles';
import { buildPlan, isAcyclic, type ResearchPlan } from './planner';
import { resolveLimits } from './quotas';
import { advancedResearchEnabled, researchWebEnabled, profileDisabled, type Depth } from './config';
import { createTask, setPlan, setStatus, setTaskStatus, listTasks, getSession, bumpUsage } from './sessions';
import { runSpecialistTask } from './specialists';
import { detectConflicts } from './conflict';
import { synthesize } from './synthesis';

/**
 * ResearchOrchestrator — the ONLY authority that plans + delegates. It generates a
 * bounded, acyclic task plan; runs specialist tasks respecting the dependency DAG,
 * parallel-agent limit, agent-run budget, source budget, and deadline; then verifies
 * + synthesizes. Specialists cannot create tasks or agents (delegation depth = 1).
 * When any budget is exhausted it STOPS launching work and synthesizes what exists
 * (PARTIALLY_COMPLETED). Nothing here can be altered by source content.
 */

export interface ResearchContext {
  plan: Plan;
  signal?: AbortSignal;
}

/** Generate + persist the plan (does not run tasks). Source content cannot add tasks. */
export async function planResearch(session: ResearchSession, depth: Depth, plan: Plan): Promise<ResearchPlan> {
  const limits = resolveLimits(plan, depth);
  const built = buildPlan({
    objective: session.objective,
    depth,
    maxTasks: limits.maxTasks,
    webEnabled: session.webEnabled && researchWebEnabled(),
    hasKnowledgeBases: session.knowledgeBaseIds.length > 0,
    hasConnections: session.connectionIds.length > 0,
  });
  if (!isAcyclic(built.tasks)) throw new Error('Invalid research plan (dependency cycle).');
  await setPlan(session.id, { questions: built.questions, areas: built.areas });
  await logSecurityEvent({ event: 'research.plan_generated', userId: session.userId, organizationId: session.organizationId, metadata: { tasks: built.tasks.length } });
  return built;
}

/** Persist the plan's tasks with resolved dependency ids. */
async function persistTasks(session: ResearchSession, built: ResearchPlan, perTaskSourceCap: number): Promise<ResearchTask[]> {
  const created: ResearchTask[] = [];
  for (const spec of built.tasks) {
    // Skip a task whose profile is disabled by the platform kill switch.
    if (profileDisabled(spec.profile) || !getProfile(spec.profile)) continue;
    const dependsOnTaskIds = spec.dependsOn.map((i) => created[i]?.id).filter(Boolean) as string[];
    const t = await createTask({
      researchSessionId: session.id,
      title: spec.title,
      objective: spec.objective,
      taskType: spec.taskType,
      priority: created.length,
      assignedProfile: spec.profile,
      allowedTools: spec.allowedTools,
      allowedSourceTypes: spec.allowedSourceTypes,
      scope: spec.scope,
      maxSources: perTaskSourceCap,
      maxCost: null,
      dependsOnTaskIds,
    });
    created.push(t);
  }
  await bumpUsage(session.id, { tasksCreated: created.length });
  return created;
}

/** Run the full research pipeline for a session. */
export async function runResearch(session: ResearchSession, ctx: ResearchContext): Promise<ResearchSession['status']> {
  if (!advancedResearchEnabled()) {
    await setStatus(session.id, 'BLOCKED', { error: 'Advanced research is disabled.' });
    return 'BLOCKED';
  }
  const depth = session.depth as Depth;
  const limits = resolveLimits(ctx.plan, depth);
  const deadline = Date.now() + limits.maxDurationMs;

  await logSecurityEvent({ event: 'research.started', userId: session.userId, organizationId: session.organizationId, metadata: { sessionId: session.id, depth } });
  const built = await planResearch(session, depth, ctx.plan);
  const perTaskCap = Math.max(1, Math.floor(limits.maxSources / Math.max(1, built.tasks.filter((t) => t.allowedSourceTypes.length).length)));
  const tasks = await persistTasks(session, built, perTaskCap);
  await setStatus(session.id, 'RUNNING', { startedAt: new Date(), deadlineAt: new Date(deadline) });

  const done = new Set<string>();
  const failed = new Set<string>();
  let agentRuns = 0;
  let sourcesUsed = 0;
  let budgetExhausted = false;

  const canRun = (t: ResearchTask) => t.dependsOnTaskIds.every((d) => done.has(d) || failed.has(d));
  const retrievalTasks = () => tasks.filter((t) => !done.has(t.id) && !failed.has(t.id) && t.taskType !== 'VERIFICATION' && t.taskType !== 'SYNTHESIS_SUPPORT' && canRun(t));

  // ---- Phase 1: retrieval specialists, in parallel up to the limit ----
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fresh = await getSession(session.id);
    if (!fresh || fresh.status === 'CANCELED') return 'CANCELED';
    if (Date.now() > deadline) { budgetExhausted = true; break; }
    const ready = retrievalTasks();
    if (ready.length === 0) break;
    if (agentRuns >= limits.maxAgentRuns || sourcesUsed >= limits.maxSources) { budgetExhausted = true; break; }

    const batch = ready.slice(0, Math.min(limits.maxParallelAgents, limits.maxAgentRuns - agentRuns));
    const results = await Promise.all(
      batch.map(async (t) => {
        await setTaskStatus(t.id, 'RUNNING', { startedAt: new Date() });
        await logSecurityEvent({ event: 'research.task_started', userId: session.userId, organizationId: session.organizationId, metadata: { taskId: t.id, profile: t.assignedProfile } });
        try {
          const r = await runSpecialistTask({ session, task: t, plan: ctx.plan, remainingSourceBudget: Math.max(0, limits.maxSources - sourcesUsed), signal: ctx.signal });
          await setTaskStatus(t.id, 'COMPLETED', { completedAt: new Date() });
          await logSecurityEvent({ event: 'research.task_completed', userId: session.userId, organizationId: session.organizationId, metadata: { taskId: t.id, sources: r.sourcesUsed } });
          return { t, ok: true, used: r.sourcesUsed };
        } catch (err) {
          logger.info('research.task.failed', { taskId: t.id, error: String(err) });
          await setTaskStatus(t.id, 'FAILED', { error: String(err).slice(0, 400), completedAt: new Date() });
          return { t, ok: false, used: 0 };
        }
      }),
    );
    for (const r of results) {
      agentRuns += 1;
      sourcesUsed += r.used;
      if (r.ok) done.add(r.t.id); else failed.add(r.t.id);
    }
    await bumpUsage(session.id, { agentRuns: batch.length, tasksCompleted: results.filter((r) => r.ok).length, sources: results.reduce((n, r) => n + r.used, 0) });
  }

  // ---- Phase 2: verification (conflict detection) ----
  if (agentRuns < limits.maxAgentRuns && Date.now() < deadline) {
    const conflicts = await detectConflicts(session);
    const verify = tasks.find((t) => t.taskType === 'VERIFICATION');
    if (verify) await setTaskStatus(verify.id, 'COMPLETED', { completedAt: new Date() });
    await logSecurityEvent({ event: 'research.claim_verified', userId: session.userId, organizationId: session.organizationId, metadata: { conflicts } });
  }

  // ---- Phase 3: synthesis (always runs on whatever evidence exists) ----
  await setStatus(session.id, 'SYNTHESIZING');
  const fresh = await getSession(session.id);
  await synthesize(fresh!, { partial: budgetExhausted || failed.size > 0 });
  const syn = tasks.find((t) => t.taskType === 'SYNTHESIS_SUPPORT');
  if (syn) await setTaskStatus(syn.id, 'COMPLETED', { completedAt: new Date() });

  if (budgetExhausted) await logSecurityEvent({ event: 'research.budget_exhausted', userId: session.userId, organizationId: session.organizationId, metadata: { agentRuns, sourcesUsed } });
  const finalStatus: ResearchSession['status'] = budgetExhausted || failed.size > 0 ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
  await setStatus(session.id, finalStatus, { completedAt: new Date() });
  await logSecurityEvent({ event: 'research.completed', userId: session.userId, organizationId: session.organizationId, metadata: { sessionId: session.id, status: finalStatus, agentRuns, sourcesUsed } });
  return finalStatus;
}

export async function cancelResearch(sessionId: string): Promise<void> {
  await setStatus(sessionId, 'CANCELED', { canceledAt: new Date() });
}

export { listTasks };
