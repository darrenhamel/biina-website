import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { profiles } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';

/**
 * Memory consent settings live on the user's profile (never environment-only).
 *  - memoryEnabled=false → no retrieval + no new inferred memory (existing preserved).
 *  - memoryMode OFF | ASK | AUTO governs INFERRED memory (explicit "remember" always works).
 */

export interface MemorySettings {
  memoryEnabled: boolean;
  memoryMode: 'OFF' | 'ASK' | 'AUTO';
  responseStyle: string;
  tone: string;
}

export async function getMemorySettings(userId: string): Promise<MemorySettings> {
  const [p] = await getDb().select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return {
    memoryEnabled: p?.memoryEnabled ?? true,
    memoryMode: (p?.memoryMode as MemorySettings['memoryMode']) ?? 'ASK',
    responseStyle: p?.responseStyle ?? 'default',
    tone: p?.tone ?? 'default',
  };
}

export async function updateMemorySettings(userId: string, patch: Partial<{ memoryEnabled: boolean; memoryMode: 'OFF' | 'ASK' | 'AUTO'; responseStyle: string; tone: string }>): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ['memoryEnabled', 'memoryMode', 'responseStyle', 'tone'] as const) if (patch[k] !== undefined) set[k] = patch[k];
  await getDb().update(profiles).set(set).where(eq(profiles.userId, userId));
  await logSecurityEvent({ event: 'memory.consent_changed', userId, actorUserId: userId, metadata: { ...('memoryEnabled' in patch ? { memoryEnabled: patch.memoryEnabled } : {}), ...('memoryMode' in patch ? { memoryMode: patch.memoryMode } : {}) } });
}
