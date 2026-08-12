import { logSecurityEvent } from '@/server/auth/events';
import { getDb } from '@/server/db';
import { researchFindings } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { listEvidence, listFindings, recordConflict } from './evidence';
import type { ResearchSession } from '@/server/db/schema';

/**
 * ClaimVerification + conflict detection. Disagreement between sources is DETECTED
 * and SURFACED — never silently resolved by picking one. A finding whose evidence
 * conflicts is marked CONFLICTING; authoritative/current sources are preferred only
 * when justified, with the disagreement still communicated.
 */

/** Extract a comparable numeric signal from an excerpt (e.g. "revenue 120M"). */
function numericSignal(text: string): { topic: string; value: number } | null {
  const m = /(\b[a-z][a-z ]{2,20}?)\s*(?:=|:|is|of|was|were|reached)?\s*\$?([\d,.]+)\s*(m|million|bn|billion|k|%)?/i.exec(text);
  if (!m) return null;
  const topic = m[1].trim().toLowerCase();
  let value = parseFloat(m[2].replace(/,/g, ''));
  const unit = (m[3] ?? '').toLowerCase();
  if (unit.startsWith('b')) value *= 1000;
  else if (unit === 'k') value /= 1000;
  return Number.isFinite(value) ? { topic, value } : null;
}

/**
 * Detect conflicting evidence: two items sharing a topic keyword but with materially
 * different numeric values. Records a ResearchConflict and flags related findings.
 */
export async function detectConflicts(session: ResearchSession): Promise<number> {
  const evidence = await listEvidence(session.id);
  const signals = evidence.map((e) => ({ e, sig: numericSignal(e.excerpt ?? e.title ?? '') })).filter((x) => x.sig) as Array<{ e: (typeof evidence)[number]; sig: { topic: string; value: number } }>;

  let conflicts = 0;
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const a = signals[i], b = signals[j];
      const sharedTopic = a.sig.topic.split(' ').some((w) => w.length > 3 && b.sig.topic.includes(w));
      if (!sharedTopic) continue;
      const diff = Math.abs(a.sig.value - b.sig.value) / Math.max(a.sig.value, b.sig.value, 1);
      if (diff >= 0.1) {
        await recordConflict(session.id, `Sources disagree on "${a.sig.topic}" (${a.sig.value} vs ${b.sig.value})`, a.e.id, b.e.id);
        conflicts += 1;
        // Flag ONLY the findings that cite either conflicting evidence item.
        const conflicting = new Set([a.e.id, b.e.id]);
        const findings = await listFindings(session.id);
        for (const f of findings) {
          if ((f.evidenceIds ?? []).some((id) => conflicting.has(id))) {
            await getDb().update(researchFindings).set({ status: 'CONFLICTING' }).where(eq(researchFindings.id, f.id)).catch(() => {});
          }
        }
      }
    }
  }
  if (conflicts) await logSecurityEvent({ event: 'research.conflict_detected', userId: session.userId, organizationId: session.organizationId, metadata: { conflicts } });
  return conflicts;
}
