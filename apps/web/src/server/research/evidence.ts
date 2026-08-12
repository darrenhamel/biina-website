import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { researchEvidence, researchFindings, researchConflicts } from '@/server/db/schema';
import type { ResearchEvidence, ResearchFinding } from '@/server/db/schema';
import type { RawEvidence } from './sources';
import { contentHash } from './sources';

/**
 * Evidence + finding store with CITATION VALIDATION. Every finding links to evidence
 * that actually exists in THIS session; every synthesis citation is checked against
 * the evidence store — model-invented citation ids are rejected, never displayed.
 * Evidence is deduplicated (canonical/mirrored/syndicated) by content hash.
 */

/** Store new evidence for a task, skipping near-duplicates already in the session. */
export async function storeEvidence(sessionId: string, taskId: string, items: RawEvidence[]): Promise<ResearchEvidence[]> {
  const existing = await getDb().select({ h: researchEvidence.contentHash }).from(researchEvidence).where(eq(researchEvidence.researchSessionId, sessionId));
  const seen = new Set(existing.map((e) => e.h).filter(Boolean) as string[]);
  const out: ResearchEvidence[] = [];
  for (const it of items) {
    const h = contentHash({ sourceId: it.sourceId, excerpt: it.excerpt });
    if (seen.has(h)) continue; // dedup canonical/mirrored/syndicated
    seen.add(h);
    const [row] = await getDb()
      .insert(researchEvidence)
      .values({ researchSessionId: sessionId, taskId, sourceType: it.sourceType, sourceId: it.sourceId.slice(0, 400), title: it.title?.slice(0, 400), sourceReference: it.sourceReference?.slice(0, 500), excerpt: it.excerpt?.slice(0, 4000), publishedAt: it.publishedAt ?? null, relevanceScore: it.relevance ?? null, qualityMetadata: it.quality ?? null, contentHash: h })
      .returning();
    out.push(row);
  }
  return out;
}

/**
 * Record a finding, keeping ONLY evidence ids that truly belong to this session
 * (claim-evidence linking is validated — unsupported major claims are dropped).
 */
export async function storeFinding(sessionId: string, taskId: string, input: { claim: string; summary?: string; evidenceIds: string[]; confidence: number; status: ResearchFinding['status'] }): Promise<ResearchFinding | null> {
  const validIds = await validateEvidenceIds(sessionId, input.evidenceIds);
  // A non-verification finding with a substantive claim MUST cite real evidence.
  if (validIds.length === 0 && input.status !== 'UNVERIFIED') return null;
  const [row] = await getDb()
    .insert(researchFindings)
    .values({ researchSessionId: sessionId, taskId, claim: input.claim.slice(0, 1000), summary: input.summary ?? null, evidenceIds: validIds, confidence: Math.max(0, Math.min(1, input.confidence)), status: input.status })
    .returning();
  return row;
}

/** Return the subset of ids that are real evidence rows in this session. */
export async function validateEvidenceIds(sessionId: string, ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id))));
  if (!unique.length) return [];
  const rows = await getDb().select({ id: researchEvidence.id }).from(researchEvidence).where(and(eq(researchEvidence.researchSessionId, sessionId), inArray(researchEvidence.id, unique)));
  return rows.map((r) => r.id);
}

export async function listEvidence(sessionId: string): Promise<ResearchEvidence[]> {
  return getDb().select().from(researchEvidence).where(eq(researchEvidence.researchSessionId, sessionId));
}
export async function listFindings(sessionId: string): Promise<ResearchFinding[]> {
  return getDb().select().from(researchFindings).where(eq(researchFindings.researchSessionId, sessionId));
}

export async function recordConflict(sessionId: string, topic: string, evidenceAId: string, evidenceBId: string): Promise<void> {
  await getDb().insert(researchConflicts).values({ researchSessionId: sessionId, topic: topic.slice(0, 500), evidenceAId, evidenceBId, status: 'OPEN' });
}
export async function listConflicts(sessionId: string) {
  return getDb().select().from(researchConflicts).where(eq(researchConflicts.researchSessionId, sessionId));
}
