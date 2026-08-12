import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { agentSessions, agentSteps, agentActions } from '@/server/db/schema';
import type { AgentSession, AgentStep, AgentAction } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';

/**
 * Agent session/step/action persistence + tenant-isolated access.
 *
 * ISOLATION mirrors connections: a PERSONAL session belongs to its owner alone; an
 * ORGANIZATION session is reachable only within THAT org's active workspace by a
 * verified member. We store operational steps only — never model chain-of-thought.
 */

export interface SessionAccess {
  session: AgentSession;
  canManage: boolean;
}

export async function resolveSessionAccess(userId: string, sessionId: string, activeOrganizationId: string | null): Promise<SessionAccess | null> {
  const [s] = await getDb().select().from(agentSessions).where(eq(agentSessions.id, sessionId)).limit(1);
  if (!s) return null;
  if (!s.organizationId) {
    if (s.userId !== userId) return null; // never another user's personal session
    return { session: s, canManage: true };
  }
  if (s.organizationId !== activeOrganizationId) return null; // wrong tenant
  const ctx = await resolveOrgContextById(userId, s.organizationId);
  if (!ctx) return null; // not a member
  // Org sessions are visible to members; only the initiating user manages them.
  return { session: s, canManage: s.userId === userId };
}

export async function createSession(input: {
  userId: string;
  organizationId: string | null;
  conversationId: string | null;
  mode: 'CHAT' | 'ASSISTED' | 'AGENT';
  goal: string;
  maxSteps: number;
  costBudget: number | null;
  currency: string;
  dryRun: boolean;
  deadlineAt: Date | null;
}): Promise<AgentSession> {
  const [row] = await getDb()
    .insert(agentSessions)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      mode: input.mode,
      status: 'PENDING',
      goal: input.goal.slice(0, 4000),
      maxSteps: input.maxSteps,
      costBudget: input.costBudget,
      currency: input.currency,
      dryRun: input.dryRun,
      deadlineAt: input.deadlineAt,
    })
    .returning();
  return row;
}

export async function setSessionStatus(sessionId: string, status: AgentSession['status'], extra: Partial<AgentSession> = {}): Promise<void> {
  await getDb().update(agentSessions).set({ status, updatedAt: new Date(), ...extra }).where(eq(agentSessions.id, sessionId));
}

export async function setSessionPlan(sessionId: string, plan: string[]): Promise<void> {
  await getDb().update(agentSessions).set({ plan, updatedAt: new Date() }).where(eq(agentSessions.id, sessionId));
}

export async function bumpSessionUsage(sessionId: string, delta: { steps?: number; toolCalls?: number; writeActions?: number; cost?: number }): Promise<void> {
  await getDb()
    .update(agentSessions)
    .set({
      stepsUsed: delta.steps ? sql`${agentSessions.stepsUsed} + ${delta.steps}` : sql`${agentSessions.stepsUsed}`,
      toolCallsUsed: delta.toolCalls ? sql`${agentSessions.toolCallsUsed} + ${delta.toolCalls}` : sql`${agentSessions.toolCallsUsed}`,
      writeActionsUsed: delta.writeActions ? sql`${agentSessions.writeActionsUsed} + ${delta.writeActions}` : sql`${agentSessions.writeActionsUsed}`,
      estimatedCost: delta.cost ? sql`${agentSessions.estimatedCost} + ${delta.cost}` : sql`${agentSessions.estimatedCost}`,
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, sessionId));
}

export async function getSession(sessionId: string): Promise<AgentSession | null> {
  const [row] = await getDb().select().from(agentSessions).where(eq(agentSessions.id, sessionId)).limit(1);
  return row ?? null;
}

// ---- Steps ----

export async function addStep(input: {
  agentSessionId: string;
  stepIndex: number;
  stepType: string;
  toolId?: string | null;
  actionId?: string | null;
  status: AgentStep['status'];
  inputSummary?: string | null;
  outputSummary?: string | null;
  requestId?: string | null;
}): Promise<AgentStep> {
  const [row] = await getDb()
    .insert(agentSteps)
    .values({
      agentSessionId: input.agentSessionId,
      stepIndex: input.stepIndex,
      stepType: input.stepType,
      toolId: input.toolId ?? null,
      actionId: input.actionId ?? null,
      status: input.status,
      inputSummary: input.inputSummary?.slice(0, 500) ?? null,
      outputSummary: input.outputSummary?.slice(0, 1000) ?? null,
      requestId: input.requestId ?? null,
      startedAt: new Date(),
      completedAt: input.status === 'RUNNING' || input.status === 'PENDING' ? null : new Date(),
    })
    .returning();
  return row;
}

export async function listSteps(sessionId: string): Promise<AgentStep[]> {
  return getDb().select().from(agentSteps).where(eq(agentSteps.agentSessionId, sessionId)).orderBy(agentSteps.stepIndex);
}

// ---- Actions ----

export async function createAction(input: {
  agentSessionId: string;
  agentStepId?: string | null;
  toolId: string;
  connectionId: string | null;
  riskLevel: string;
  reversibility: string;
  approvalStatus: string;
  normalizedArguments: Record<string, unknown> | null;
  argumentsHash: string | null;
  status: AgentAction['status'];
  idempotencyKey: string | null;
}): Promise<AgentAction> {
  const [row] = await getDb()
    .insert(agentActions)
    .values({
      agentSessionId: input.agentSessionId,
      agentStepId: input.agentStepId ?? null,
      toolId: input.toolId,
      connectionId: input.connectionId,
      riskLevel: input.riskLevel,
      reversibility: input.reversibility,
      approvalStatus: input.approvalStatus,
      normalizedArguments: input.normalizedArguments,
      argumentsHash: input.argumentsHash,
      status: input.status,
      idempotencyKey: input.idempotencyKey,
    })
    .returning();
  return row;
}

export async function updateAction(actionId: string, patch: Partial<AgentAction>): Promise<void> {
  await getDb().update(agentActions).set(patch).where(eq(agentActions.id, actionId));
}

export async function getAction(actionId: string): Promise<AgentAction | null> {
  const [row] = await getDb().select().from(agentActions).where(eq(agentActions.id, actionId)).limit(1);
  return row ?? null;
}

/** Idempotency lookup: has this exact normalized action already run in the session? */
export async function findExecutedAction(sessionId: string, idempotencyKey: string): Promise<AgentAction | null> {
  const [row] = await getDb()
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.agentSessionId, sessionId), eq(agentActions.idempotencyKey, idempotencyKey)))
    .limit(1);
  return row ?? null;
}

export async function listActions(sessionId: string): Promise<AgentAction[]> {
  return getDb().select().from(agentActions).where(eq(agentActions.agentSessionId, sessionId)).orderBy(agentActions.createdAt);
}

export async function listSessionsForScope(scope: { userId: string; organizationId: string | null }, limit = 25): Promise<AgentSession[]> {
  const where = scope.organizationId ? eq(agentSessions.organizationId, scope.organizationId) : and(eq(agentSessions.userId, scope.userId), sql`${agentSessions.organizationId} is null`);
  return getDb().select().from(agentSessions).where(where).orderBy(desc(agentSessions.createdAt)).limit(limit);
}
