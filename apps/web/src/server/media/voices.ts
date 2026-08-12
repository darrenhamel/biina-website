import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { voiceProfiles } from '@/server/db/schema';
import type { VoiceProfile } from '@/server/db/schema';

/**
 * Voice registry — logical BIINA voice identities mapped to provider voices. The
 * UI/settings reference the BIINA slug (e.g. "biina-en-1"), never a provider voice
 * id. At least one English and one Arabic-capable voice ship as configuration.
 */

export const DEFAULT_VOICES: Array<Omit<VoiceProfile, 'id' | 'createdAt'>> = [
  { slug: 'biina-en-1', displayName: 'Biina Voice (English)', provider: 'mock', providerVoiceId: 'mock-en', language: 'en', locale: 'en-US', enabled: true },
  { slug: 'biina-ar-1', displayName: 'Biina Voice (Arabic)', provider: 'mock', providerVoiceId: 'mock-ar', language: 'ar', locale: 'ar-AE', enabled: true },
];

export async function listVoices(): Promise<VoiceProfile[]> {
  return getDb().select().from(voiceProfiles).where(eq(voiceProfiles.enabled, true)).orderBy(voiceProfiles.displayName);
}

export async function getVoice(slug: string): Promise<VoiceProfile | null> {
  const [v] = await getDb().select().from(voiceProfiles).where(and(eq(voiceProfiles.slug, slug), eq(voiceProfiles.enabled, true))).limit(1);
  return v ?? null;
}

/** Resolve a requested voice, or the first enabled voice for the language, or any. */
export async function resolveVoice(slug: string | undefined, language: string): Promise<VoiceProfile | null> {
  if (slug) {
    const v = await getVoice(slug);
    if (v) return v;
  }
  const all = await listVoices();
  return all.find((v) => v.language === language) ?? all[0] ?? null;
}
