import type { Plan } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { parseExplicitMemoryCommand, extractCandidates, supersedeConflicting } from './extraction';
import { createMemory, deleteMemory, resolveMemoryAccess } from './store';
import { getMemorySettings } from './consent';
import { retrieveMemories } from './retrieval';
import { memoryPlatformEnabled, memoryInferenceEnabled, memoryAutoSaveEnabled } from './config';

/**
 * Chat-facing memory helpers. Explicit "remember/forget" commands are handled
 * reliably + synchronously (full confidence); inferred extraction runs best-effort
 * AFTER the response and only in ASK/AUTO mode. External/tool content is never a
 * source here — only the user's own message text is passed in.
 */

export interface ExplicitResult {
  handled: boolean;
  reply?: string;
}

/**
 * If the user's message is an explicit memory command, act on it and return a short
 * reply (the chat route can short-circuit). Personal scope only in chat.
 */
export async function handleExplicitMemory(input: { message: string; userId: string; organizationId: string | null; conversationId: string | null; plan: Plan; temporary: boolean }): Promise<ExplicitResult> {
  if (input.temporary) return { handled: false };
  if (!memoryPlatformEnabled() || !input.plan.memoryEnabled) return { handled: false };
  const settings = await getMemorySettings(input.userId);
  if (!settings.memoryEnabled) return { handled: false };

  const cmd = parseExplicitMemoryCommand(input.message);
  if (!cmd) return { handled: false };

  if (cmd.action === 'remember') {
    try {
      const mem = await createMemory({
        ownerType: 'PERSONAL',
        ownerUserId: input.userId,
        organizationId: null,
        createdByUserId: input.userId,
        memoryType: 'PREFERENCE',
        content: cmd.content,
        sourceType: 'USER_EXPLICIT',
        sourceId: input.conversationId,
        confidence: 1,
        plan: input.plan,
      });
      await supersedeConflicting(mem, input.userId); // newer explicit statement wins
      return { handled: true, reply: `Got it — I'll remember that ${cmd.content}. You can review or delete this in Settings → Personalization → Memory.` };
    } catch (err) {
      return { handled: true, reply: (err as Error).message || 'I could not store that as memory.' };
    }
  }

  // forget: find the closest matching personal memory and delete it.
  const matches = await retrieveMemories({ userId: input.userId, organizationId: null, query: cmd.query, maxResults: 1, minRelevance: 0.2 });
  if (!matches.length) return { handled: true, reply: `I couldn't find a memory matching "${cmd.query}".` };
  const access = await resolveMemoryAccess(input.userId, matches[0].id, null);
  if (access) await deleteMemory(access, input.userId);
  return { handled: true, reply: `Done — I've forgotten "${matches[0].content}".` };
}

/**
 * Best-effort inferred-candidate extraction, run AFTER the response so it never
 * blocks the reply. Only in ASK/AUTO mode; AUTO auto-accepts low-risk candidates.
 */
export async function maybeExtractCandidates(input: { message: string; userId: string; organizationId: string | null; conversationId: string | null; plan: Plan; temporary: boolean }): Promise<void> {
  // Requires the platform inference flag + plan + not-temporary.
  if (input.temporary || !memoryPlatformEnabled() || !memoryInferenceEnabled() || !input.plan.memoryEnabled || !input.plan.autoMemoryEnabled) return;
  try {
    const settings = await getMemorySettings(input.userId);
    if (!settings.memoryEnabled || settings.memoryMode === 'OFF') return;
    const candidates = await extractCandidates({ userText: input.message, userId: input.userId, organizationId: input.organizationId, conversationId: input.conversationId });
    // AUTO_SAVE_LOW_RISK requires AUTO consent AND the platform auto-save flag.
    if (settings.memoryMode === 'AUTO' && memoryAutoSaveEnabled()) {
      const { acceptCandidate } = await import('./extraction');
      for (const c of candidates) if (c.sensitivity === 'NORMAL') await acceptCandidate(c, input.userId, input.plan, false).catch(() => {});
    }
  } catch (err) {
    logger.warn('memory.extract.failed', { error: String(err) });
  }
}
