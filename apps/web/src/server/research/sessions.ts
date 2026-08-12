import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { researchSessions, researchTasks } from '@/server/db/schema';
import type { ResearchSession, ResearchTask } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';

/**
 * Research session/task persistence + tenant isolation. A session belongs to ONE
 * workspace context (personal XOR org); it never retrieves data from an unrelated
 * organization. Access is verified server-side, never from the browser.
 */

export interface ResearchAccess {
  session: ResearchSession;
  canManage: boolean;
}

export async function resolveResearchAccess(userId: string, sessionId: string, activeOrganizationId: string | null): Promise<ResearchAccess | null> {
  const [s] = await getDb().select().from(researchSessions).where(eq(researchSessions.id, sessionId)).limit(1);
  if (!s) return null;
  if (!s.organizationId) {
    if (s.userId !== userId) return null;
    return { session: s, canManage: true };
  }
  if (s.organizationId !== activeOrganizationId) return null;
  const ctx = await resolveOrgContextById(userId, s.organizationId);
  if (!ctx) return null;
  return { session: s, canManage: s.userId === userId };
}

export async function createSession(input: Omit<ResearchSession, 'id' | 'status' | 'tasksCreated' | 'tasksCompleted' | 'sourcesCollected' | 'agentRunsUsed' | 'estimatedCost' | 'plan' | 'error' | 'startedAt' | 'completedAt' | 'canceledAt' | 'createdAt' | 'updatedAt'>): Promise<ResearchSession> {
  const [row] = await getDb().insert(researchSessions).values({ ...input, status: 'PLANNING' }).returning();
  return row;
}

export async function getSession(id: string): Promise<ResearchSession | null> {
  const [s] = await getDb().select().from(researchSessions).where(eq(researchSessions.id, id)).limit(1);
  return s ?? null;
}

export async function setStatus(id: string, status: ResearchSession['status'], extra: Partial<ResearchSession> = {}): Promise<void> {
  await getDb().update(researchSessions).set({ status, updatedAt: new Date(), ...extra }).where(eq(researchSessions.id, id));
}

export async function setPlan(id: string, plan: { questions: string[]; areas: string[] }): Promise<void> {
  await getDb().update(researchSessions).set({ plan, updatedAt: new Date() }).where(eq(researchSessions.id, id));
}

export async function bumpUsage(id: string, delta: { tasksCreated?: number; tasksCompleted?: number; sources?: number; agentRuns?: number; cost?: number }): Promise<void> {
  await getDb()
    .update(researchSessions)
    .set({
      tasksCreated: delta.tasksCreated ? sql`${researchSessions.tasksCreated} + ${delta.tasksCreated}` : sql`${researchSessions.tasksCreated}`,
      tasksCompleted: delta.tasksCompleted ? sql`${researchSessions.tasksCompleted} + ${delta.tasksCompleted}` : sql`${researchSessions.tasksCompleted}`,
      sourcesCollected: delta.sources ? sql`${researchSessions.sourcesCollected} + ${delta.sources}` : sql`${researchSessions.sourcesCollected}`,
      agentRunsUsed: delta.agentRuns ? sql`${researchSessions.agentRunsUsed} + ${delta.agentRuns}` : sql`${researchSessions.agentRunsUsed}`,
      estimatedCost: delta.cost ? sql`${researchSessions.estimatedCost} + ${delta.cost}` : sql`${researchSessions.estimatedCost}`,
      updatedAt: new Date(),
    })
    .where(eq(researchSessions.id, id));
}

export async function createTask(input: Omit<ResearchTask, 'id' | 'status' | 'error' | 'startedAt' | 'completedAt' | 'createdAt'>): Promise<ResearchTask> {
  const [row] = await getDb().insert(researchTasks).values({ ...input, status: 'PENDING' }).returning();
  return row;
}

export async function setTaskStatus(id: string, status: ResearchTask['status'], extra: Partial<ResearchTask> = {}): Promise<void> {
  await getDb().update(researchTasks).set({ status, ...extra }).where(eq(researchTasks.id, id));
}

export async function listTasks(sessionId: string): Promise<ResearchTask[]> {
  return getDb().select().from(researchTasks).where(eq(researchTasks.researchSessionId, sessionId)).orderBy(researchTasks.priority);
}

export async function listSessionsForScope(scope: { userId: string; organizationId: string | null }, limit = 25): Promise<ResearchSession[]> {
  const where = scope.organizationId ? eq(researchSessions.organizationId, scope.organizationId) : and(eq(researchSessions.userId, scope.userId), isNull(researchSessions.organizationId));
  return getDb().select().from(researchSessions).where(where).orderBy(desc(researchSessions.createdAt)).limit(limit);
}
