import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { memories, memoryCandidates } from '@/server/db/schema';
import type { Memory, MemoryCandidate, Plan } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { getEmbeddingProvider, cosineSimilarity } from '@/server/rag/embeddings';
import { classifySensitivity, isAutoInferable, isStorableContent, looksLikeInjection, containsSecret } from './sensitivity';
import { createMemory, supersede } from './store';

/**
 * MemoryExtractionService.
 *
 * TRUST BOUNDARY (poisoning defense): candidates are derived ONLY from the user's
 * OWN messages, passed in by a trusted caller. Tool results, connected data, web
 * pages, and documents are UNTRUSTED and are NEVER a source of durable memory here.
 * The model (or a deterministic fallback) only proposes STRUCTURED candidates; the
 * server validates + gates them. Explicit "remember" commands bypass inference with
 * full confidence.
 */

// ---- Explicit "remember / forget" commands (deterministic) ----

export type ExplicitCommand =
  | { action: 'remember'; content: string }
  | { action: 'forget'; query: string }
  | null;

export function parseExplicitMemoryCommand(message: string): ExplicitCommand {
  const t = message.trim();
  const remember = /^(?:please\s+)?(?:remember|note|keep in mind|don'?t forget)(?:\s+that)?\s+(.+)/i.exec(t);
  if (remember) return { action: 'remember', content: remember[1].replace(/[.!]+$/, '').trim() };
  const forget = /^(?:please\s+)?(?:forget|stop remembering|delete the memory)(?:\s+that|\s+about)?\s+(.+)/i.exec(t);
  if (forget) return { action: 'forget', query: forget[1].replace(/[.!]+$/, '').trim() };
  return null;
}

// ---- Ephemeral fact detection (don't persist "today / at 3pm / tomorrow") ----

const EPHEMERAL = [/\b(?:today|tonight|tomorrow|yesterday|this (?:morning|afternoon|evening|week)|right now|at \d{1,2}\s?(?:am|pm)|in \d+ (?:minutes|hours|days))\b/i];
export function isEphemeral(text: string): boolean {
  return EPHEMERAL.some((re) => re.test(text));
}

// ---- Inferred candidate extraction (pluggable model; deterministic fallback) ----

export interface CandidateProposal {
  shouldRemember: boolean;
  type: Memory['memoryType'];
  content: string;
  confidence: number;
  sensitivity: 'NORMAL' | 'SENSITIVE' | 'RESTRICTED';
}

export type ExtractorFn = (userText: string) => Promise<CandidateProposal[]>;

/** Deterministic offline extractor: durable "I prefer / I like / always" statements. */
const defaultExtractor: ExtractorFn = async (userText: string) => {
  const out: CandidateProposal[] = [];
  const m = /\bI (?:prefer|like|usually want|always want|generally want)\s+(.+)/i.exec(userText);
  if (m && !isEphemeral(userText)) {
    out.push({ shouldRemember: true, type: 'PREFERENCE', content: `User prefers ${m[1].replace(/[.!]+$/, '').trim()}`, confidence: 0.7, sensitivity: classifySensitivity(userText) });
  }
  const proj = /\b(?:I'?m|I am|we'?re|we are) working on (?:project\s+)?([A-Z][\w-]+)/.exec(userText);
  if (proj) out.push({ shouldRemember: true, type: 'PROJECT_CONTEXT', content: `User is working on project ${proj[1]}`, confidence: 0.65, sensitivity: 'NORMAL' });
  return out;
};

let extractor: ExtractorFn = defaultExtractor;
export function __setExtractor(fn: ExtractorFn | null): void {
  extractor = fn ?? defaultExtractor;
}

/**
 * Produce PENDING candidates from the user's own message. Never persists memory
 * directly (that needs consent in ASK mode). Rejects secrets/injections/ephemeral
 * /sensitive-auto. Returns the created candidates.
 */
export async function extractCandidates(input: { userText: string; userId: string; organizationId: string | null; conversationId: string | null }): Promise<MemoryCandidate[]> {
  // The candidate source is the user's message ONLY — never untrusted tool/web content.
  if (looksLikeInjection(input.userText) || containsSecret(input.userText)) return [];
  const proposals = await extractor(input.userText);
  const created: MemoryCandidate[] = [];
  for (const p of proposals) {
    if (!p.shouldRemember) continue;
    const storable = isStorableContent(p.content);
    if (!storable.ok) continue;
    if (isEphemeral(p.content)) continue; // temporary facts don't become durable memory
    // Auto-inference is limited to NORMAL content; sensitive needs explicit consent later.
    if (!isAutoInferable(p.content)) continue;
    // Skip if a near-duplicate active memory already exists.
    if (await hasDuplicateMemory(input.userId, input.organizationId, p.content)) continue;
    const [row] = await getDb()
      .insert(memoryCandidates)
      .values({ ownerUserId: input.userId, organizationId: input.organizationId, conversationId: input.conversationId, candidateContent: p.content.slice(0, 2000), memoryType: p.type, confidence: Math.max(0, Math.min(1, p.confidence)), sensitivity: classifySensitivity(p.content), reason: 'Suggested from this conversation as it may be useful later.', status: 'PENDING' })
      .returning();
    created.push(row);
    await logSecurityEvent({ event: 'memory.candidate_created', userId: input.userId, actorUserId: input.userId, organizationId: input.organizationId, metadata: { candidateId: row.id, type: p.type } });
  }
  return created;
}

async function hasDuplicateMemory(userId: string, organizationId: string | null, content: string): Promise<boolean> {
  const [q] = await getEmbeddingProvider().embed([content]);
  const where = organizationId
    ? and(eq(memories.organizationId, organizationId), eq(memories.status, 'ACTIVE'))
    : and(eq(memories.ownerUserId, userId), isNull(memories.organizationId), eq(memories.status, 'ACTIVE'));
  const rows = await getDb().select().from(memories).where(where);
  return rows.some((r) => r.embedding && cosineSimilarity(q, r.embedding) >= 0.9);
}

/** Accept a candidate → create a real memory (with consent for sensitive content). */
export async function acceptCandidate(candidate: MemoryCandidate, actorUserId: string, plan?: Plan, consented = false): Promise<Memory> {
  const mem = await createMemory({
    ownerType: candidate.organizationId ? 'ORGANIZATION' : 'PERSONAL',
    ownerUserId: candidate.ownerUserId,
    organizationId: candidate.organizationId,
    createdByUserId: actorUserId,
    memoryType: candidate.memoryType,
    content: candidate.candidateContent,
    sourceType: 'CONVERSATION_INFERRED',
    sourceId: candidate.conversationId,
    confidence: candidate.confidence,
    consented,
    plan,
  });
  await getDb().update(memoryCandidates).set({ status: 'ACCEPTED', decidedAt: new Date() }).where(eq(memoryCandidates.id, candidate.id));
  await supersedeConflicting(mem, actorUserId);
  return mem;
}

export async function rejectCandidate(candidateId: string, userId: string): Promise<void> {
  await getDb().update(memoryCandidates).set({ status: 'REJECTED', decidedAt: new Date() }).where(and(eq(memoryCandidates.id, candidateId), eq(memoryCandidates.ownerUserId, userId)));
  await logSecurityEvent({ event: 'memory.candidate_rejected', userId, actorUserId: userId, metadata: { candidateId } });
}

/**
 * Contradiction handling: when a new memory is created, supersede same-type memories
 * that are semantically close but differ in content (the newer statement wins).
 */
export async function supersedeConflicting(newMemory: Memory, actorUserId: string): Promise<void> {
  if (!newMemory.embedding) return;
  const where = newMemory.organizationId
    ? and(eq(memories.organizationId, newMemory.organizationId), eq(memories.status, 'ACTIVE'), eq(memories.memoryType, newMemory.memoryType))
    : and(eq(memories.ownerUserId, newMemory.ownerUserId ?? ''), isNull(memories.organizationId), eq(memories.status, 'ACTIVE'), eq(memories.memoryType, newMemory.memoryType));
  const rows = await getDb().select().from(memories).where(where);
  for (const r of rows) {
    if (r.id === newMemory.id || !r.embedding) continue;
    const sim = cosineSimilarity(newMemory.embedding, r.embedding);
    // Same topic (clearly related) but not identical content (dedup handles ~1.0) →
    // the newer statement supersedes the old. The floor is a lower bound tuned for
    // the dev embedder; production semantic models score related pairs well above it.
    if (sim >= 0.6 && sim < 0.95 && r.content.trim().toLowerCase() !== newMemory.content.trim().toLowerCase()) {
      await supersede(r.id, newMemory.id, actorUserId);
    }
  }
}

export async function listCandidates(userId: string): Promise<MemoryCandidate[]> {
  return getDb().select().from(memoryCandidates).where(and(eq(memoryCandidates.ownerUserId, userId), eq(memoryCandidates.status, 'PENDING')));
}
