import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { researchResults } from '@/server/db/schema';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound } from '@/lib/api';
import { resolveResearchAccess, listTasks } from '@/server/research/sessions';
import { listEvidence, listFindings, listConflicts } from '@/server/research/evidence';

/** GET /api/research/[id] — full run detail: plan, tasks, sources, findings, report. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveResearchAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Research not found');
    const s = access.session;

    const [tasks, evidence, findings, conflicts, resultRows] = await Promise.all([
      listTasks(s.id),
      listEvidence(s.id),
      listFindings(s.id),
      listConflicts(s.id),
      getDb().select().from(researchResults).where(eq(researchResults.researchSessionId, s.id)).limit(1),
    ]);
    const result = resultRows[0] ?? null;

    return ok({
      session: { id: s.id, objective: s.objective, status: s.status, depth: s.depth, plan: s.plan, tasksCreated: s.tasksCreated, tasksCompleted: s.tasksCompleted, sourcesCollected: s.sourcesCollected, agentRunsUsed: s.agentRunsUsed, estimatedCost: s.estimatedCost, createdAt: s.createdAt, completedAt: s.completedAt },
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, type: t.taskType, profile: t.assignedProfile, status: t.status, scope: t.scope })),
      // Source panel — provenance metadata (private sources remain access-controlled).
      sources: evidence.map((e) => ({ id: e.id, title: e.title, sourceType: e.sourceType, reference: e.sourceReference, retrievedAt: e.retrievedAt, publishedAt: e.publishedAt, quality: e.qualityMetadata })),
      findings: findings.map((f) => ({ id: f.id, claim: f.claim, confidence: f.confidence, status: f.status, citationIds: f.evidenceIds })),
      conflicts: conflicts.map((c) => ({ id: c.id, topic: c.topic, status: c.status })),
      result: result ? { executiveSummary: result.executiveSummary, findings: result.findings, analysis: result.analysis, uncertainties: result.uncertainties, citationIds: result.citationIds, partial: result.partial } : null,
    });
  } catch (err) {
    return handleError(err, 'research.detail');
  }
}
