import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { researchSessions, researchTasks } from '@/server/db/schema';
import { advancedResearchEnabled, multiAgentResearchEnabled, researchWebEnabled } from './config';

/** Admin research observability — operational metadata only, never private content. */
export async function researchOverview(scope: { organizationId?: string | null } = {}): Promise<{
  killSwitches: { advancedResearch: boolean; multiAgent: boolean; web: boolean };
  sessions: { total: number; completed: number; partial: number; failed: number; blocked: number; running: number };
  today: number;
  avgSources: number;
  avgCost: number;
  avgTasks: number;
  recent: Array<{ id: string; status: string; depth: string; objective: string; sources: number; createdAt: string }>;
}> {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const where = scope.organizationId ? and(gte(researchSessions.createdAt, since), eq(researchSessions.organizationId, scope.organizationId)) : gte(researchSessions.createdAt, since);

  const [rows, today, recent] = await Promise.all([
    db.select({ status: researchSessions.status, sources: researchSessions.sourcesCollected, cost: researchSessions.estimatedCost, tasks: researchSessions.tasksCreated }).from(researchSessions).where(where),
    db.select({ n: sql<number>`count(*)::int` }).from(researchSessions).where(gte(researchSessions.createdAt, startOfDay)),
    db.select({ id: researchSessions.id, status: researchSessions.status, depth: researchSessions.depth, objective: researchSessions.objective, sources: researchSessions.sourcesCollected, createdAt: researchSessions.createdAt }).from(researchSessions).where(where).orderBy(desc(researchSessions.createdAt)).limit(20),
  ]);
  void researchTasks;
  const n = rows.length || 1;
  return {
    killSwitches: { advancedResearch: advancedResearchEnabled(), multiAgent: multiAgentResearchEnabled(), web: researchWebEnabled() },
    sessions: {
      total: rows.length,
      completed: rows.filter((r) => r.status === 'COMPLETED').length,
      partial: rows.filter((r) => r.status === 'PARTIALLY_COMPLETED').length,
      failed: rows.filter((r) => r.status === 'FAILED').length,
      blocked: rows.filter((r) => r.status === 'BLOCKED').length,
      running: rows.filter((r) => r.status === 'RUNNING' || r.status === 'PLANNING' || r.status === 'SYNTHESIZING').length,
    },
    today: today[0]?.n ?? 0,
    avgSources: Math.round((rows.reduce((s, r) => s + r.sources, 0) / n) * 10) / 10,
    avgCost: Math.round((rows.reduce((s, r) => s + Number(r.cost ?? 0), 0) / n) * 10000) / 10000,
    avgTasks: Math.round((rows.reduce((s, r) => s + r.tasks, 0) / n) * 10) / 10,
    recent: recent.map((r) => ({ id: r.id, status: r.status, depth: r.depth, objective: r.objective.slice(0, 140), sources: r.sources, createdAt: r.createdAt.toISOString() })),
  };
}

export const RESEARCH_TEMPLATES = [
  { slug: 'market-analysis', name: 'Market Analysis', objective: 'Analyze the market size, growth, and key players for {topic}.', depth: 'STANDARD' as const },
  { slug: 'competitor-comparison', name: 'Competitor Comparison', objective: 'Compare the leading providers of {topic} on pricing, positioning, and strengths.', depth: 'STANDARD' as const },
  { slug: 'vendor-due-diligence', name: 'Vendor Due Diligence', objective: 'Evaluate {vendor} using their documentation, pricing, reviews, and our internal requirements.', depth: 'DEEP' as const },
  { slug: 'regulatory-research', name: 'Regulatory Research', objective: 'Research recent changes to {regulation} using primary sources and compare interpretations.', depth: 'DEEP' as const },
  { slug: 'executive-brief', name: 'Executive Brief', objective: 'Prepare an evidence-based executive brief on {topic} using internal knowledge and current external sources.', depth: 'STANDARD' as const },
];
