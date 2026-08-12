import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { profiles } from '@/server/db/schema';
import type { Profile } from '@/server/db/schema';

/**
 * PersonalizationService — turns EXPLICIT, authoritative profile settings (response
 * style, tone, language) into a small instruction layer. These are account settings,
 * NOT inferred memory, so they carry higher trust — but the current explicit request
 * always overrides them (see the ContextEngine precedence + the instruction text).
 */

export interface Personalization {
  responseStyle: 'default' | 'concise' | 'detailed';
  tone: 'default' | 'formal' | 'casual';
  locale: string;
}

export async function getPersonalization(userId: string): Promise<Personalization> {
  const [p] = await getDb().select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return normalize(p);
}

function normalize(p: Profile | undefined): Personalization {
  return {
    responseStyle: (p?.responseStyle as Personalization['responseStyle']) ?? 'default',
    tone: (p?.tone as Personalization['tone']) ?? 'default',
    locale: p?.locale ?? 'en',
  };
}

/** Build the personalization instruction, or '' if nothing non-default is set. */
export function personalizationInstruction(p: Personalization): string {
  const parts: string[] = [];
  if (p.responseStyle === 'concise') parts.push('Prefer concise, executive-style answers.');
  else if (p.responseStyle === 'detailed') parts.push('Prefer thorough, detailed answers.');
  if (p.tone === 'formal') parts.push('Use a formal, professional tone.');
  else if (p.tone === 'casual') parts.push('Use a friendly, casual tone.');
  if (!parts.length) return '';
  return `The user has these default presentation preferences (apply them only when they do not conflict with the current request, which always wins): ${parts.join(' ')}`;
}
