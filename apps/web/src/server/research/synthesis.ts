import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { researchResults } from '@/server/db/schema';
import type { ResearchSession, ResearchResult } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { listEvidence, listFindings, listConflicts, validateEvidenceIds } from './evidence';

/**
 * Synthesis — produces the final report GROUNDED strictly on verified findings +
 * evidence. Every citation is validated against the evidence store; fabricated
 * citation ids are dropped and NEVER displayed. Unresolved conflicts are surfaced
 * as explicit uncertainties (no manufactured consensus). Findings that appear only
 * in the model's prose but cite no real evidence are discarded.
 */

export async function synthesize(session: ResearchSession, opts: { partial: boolean }): Promise<ResearchResult> {
  const [evidence, findings, conflicts] = await Promise.all([listEvidence(session.id), listFindings(session.id), listConflicts(session.id)]);

  // Keep only findings backed by REAL evidence in this session (citation validation).
  const grounded: Array<{ claim: string; confidence: number; status: string; citationIds: string[] }> = [];
  const allCitationIds = new Set<string>();
  for (const f of findings) {
    const valid = await validateEvidenceIds(session.id, f.evidenceIds ?? []);
    if (valid.length === 0) continue; // unsupported → excluded from the report
    valid.forEach((id) => allCitationIds.add(id));
    grounded.push({ claim: f.claim, confidence: f.confidence, status: f.status, citationIds: valid });
  }

  // De-duplicate identical claims (keep the highest-confidence + union of citations).
  const byClaim = new Map<string, { claim: string; confidence: number; status: string; citationIds: string[] }>();
  for (const g of grounded) {
    const key = g.claim.trim().toLowerCase();
    const prev = byClaim.get(key);
    if (!prev) byClaim.set(key, g);
    else byClaim.set(key, { ...prev, confidence: Math.max(prev.confidence, g.confidence), citationIds: Array.from(new Set([...prev.citationIds, ...g.citationIds])) });
  }
  const finalFindings = [...byClaim.values()];

  const uncertainties = conflicts.map((c) => c.topic);
  const summary = finalFindings.length
    ? `Synthesized ${finalFindings.length} evidence-backed finding(s) from ${evidence.length} source(s) about: ${session.objective}.` + (uncertainties.length ? ` ${uncertainties.length} unresolved conflict(s) remain.` : '')
    : `No sufficiently-supported findings were collected for: ${session.objective}.`;

  const [row] = await getDb()
    .insert(researchResults)
    .values({ researchSessionId: session.id, version: 1, executiveSummary: summary, findings: finalFindings, analysis: null, recommendations: null, uncertainties, citationIds: [...allCitationIds], partial: opts.partial })
    .onConflictDoNothing()
    .returning();

  await logSecurityEvent({ event: 'research.synthesis_completed', userId: session.userId, organizationId: session.organizationId, metadata: { findings: finalFindings.length, citations: allCitationIds.size, uncertainties: uncertainties.length } });
  return row ?? (await getDb().select().from(researchResults).where(eq(researchResults.researchSessionId, session.id)).limit(1))[0];
}
