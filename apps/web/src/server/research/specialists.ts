import type { Plan, ResearchSession, ResearchTask } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { getProfile, profileIsReadOnly, type ResearchSourceType } from './profiles';
import { getSourceProvider, type RawEvidence } from './sources';
import { storeEvidence, storeFinding } from './evidence';

/**
 * Specialist executor — a BOUNDED, READ-ONLY worker. It uses ONLY the tools/source
 * types its task allows (tool minimization), retrieves within the task + session
 * source budget, and emits evidence + findings. It CANNOT create tasks or agents,
 * cannot write to any external system, and cannot widen its own scope. Source
 * content it reads is untrusted data and can never change any of this.
 */

export interface SpecialistResult {
  evidenceCount: number;
  findingCount: number;
  sourcesUsed: number;
}

export async function runSpecialistTask(input: {
  session: ResearchSession;
  task: ResearchTask;
  plan: Plan;
  remainingSourceBudget: number;
  signal?: AbortSignal;
}): Promise<SpecialistResult> {
  const profile = getProfile(input.task.assignedProfile);
  if (!profile || !profileIsReadOnly(profile)) {
    // A profile must exist and be structurally read-only — otherwise refuse.
    await logSecurityEvent({ event: 'research.blocked', userId: input.session.userId, organizationId: input.session.organizationId, metadata: { reason: 'invalid_or_write_profile', profile: input.task.assignedProfile } });
    return { evidenceCount: 0, findingCount: 0, sourcesUsed: 0 };
  }

  // Retrieval-type tasks gather evidence; analysis tasks operate on existing evidence.
  const sourceTypes = (input.task.allowedSourceTypes as ResearchSourceType[]).filter((st) => profile.allowedSourceTypes.includes(st)); // scope ∩ profile
  if (sourceTypes.length === 0) return { evidenceCount: 0, findingCount: 0, sourcesUsed: 0 };

  const perTaskCap = Math.max(0, Math.min(input.task.maxSources, profile.maxSources, input.remainingSourceBudget));
  if (perTaskCap === 0) return { evidenceCount: 0, findingCount: 0, sourcesUsed: 0 };

  const collected: RawEvidence[] = [];
  const provider = getSourceProvider();
  for (const st of sourceTypes) {
    if (collected.length >= perTaskCap) break;
    const items = await provider.retrieve({
      sourceType: st,
      query: input.task.objective,
      userId: input.session.userId,
      organizationId: input.session.organizationId, // tenant scope inherited by the retrieval layer
      knowledgeBaseIds: input.session.knowledgeBaseIds,
      connectionIds: input.session.connectionIds,
      plan: input.plan,
      max: perTaskCap - collected.length,
      signal: input.signal,
    });
    for (const it of items) if (collected.length < perTaskCap) collected.push(it);
  }

  const stored = await storeEvidence(input.session.id, input.task.id, collected);
  await logSecurityEvent({ event: 'research.source_accessed', userId: input.session.userId, organizationId: input.session.organizationId, metadata: { taskId: input.task.id, sources: stored.length } });

  // One evidence-backed finding per stored source (claim ← the source's excerpt).
  let findings = 0;
  for (const e of stored) {
    const f = await storeFinding(input.session.id, input.task.id, { claim: (e.title ?? e.excerpt ?? '').slice(0, 400) || 'Finding', summary: e.excerpt ?? undefined, evidenceIds: [e.id], confidence: e.qualityMetadata && (e.qualityMetadata as { primarySource?: boolean }).primarySource ? 0.8 : 0.6, status: 'SUPPORTED' });
    if (f) findings += 1;
  }
  return { evidenceCount: stored.length, findingCount: findings, sourcesUsed: stored.length };
}
