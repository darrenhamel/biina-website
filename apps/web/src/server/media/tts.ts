import { getDb } from '@/server/db';
import { mediaAssets } from '@/server/db/schema';
import type { Plan, MediaAsset } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { getFileStorage } from '@/server/rag/storage';
import { getTtsProvider } from './providers';
import { resolveVoice } from './voices';
import { assertTts, meterMedia } from './usage';
import { MediaError } from './errors';

/**
 * TextToSpeech — synthesizes an assistant response into an AUDIO media asset scoped
 * to the requesting user/workspace (never globally cached). Voice is a BIINA logical
 * voice; provider voice ids stay server-side. TTS is opt-in (read-aloud / voice
 * mode), never automatic — this bounds cost.
 */

export async function synthesizeSpeech(input: { text: string; voiceSlug?: string; language?: string; userId: string; organizationId: string | null; plan: Plan; requestId?: string | null }): Promise<{ media: MediaAsset; durationMs: number }> {
  const text = input.text.trim().slice(0, 20_000);
  if (!text) throw new MediaError('TTS_FAILED');
  await assertTts(input.plan, input.userId, text.length);

  const voice = await resolveVoice(input.voiceSlug, input.language ?? 'en');
  if (!voice) throw new MediaError('TTS_FAILED');

  const provider = getTtsProvider();
  try {
    const res = await provider.synthesize({ text, providerVoiceId: voice.providerVoiceId, language: voice.language });
    const stored = await getFileStorage().put(res.bytes, { extension: res.mime.includes('wav') ? 'wav' : 'mp3' });
    const [media] = await getDb()
      .insert(mediaAssets)
      .values({ ownerUserId: input.organizationId ? null : input.userId, organizationId: input.organizationId, uploadedByUserId: input.userId, mediaType: 'AUDIO', mimeType: res.mime, sizeBytes: res.bytes.length, storageProvider: getFileStorage().name, storageKey: stored.storageKey, durationMs: res.durationMs, status: 'READY' })
      .returning();
    await meterMedia({ operation: 'TEXT_TO_SPEECH', userId: input.userId, organizationId: input.organizationId, mediaAssetId: media.id, provider: provider.name, units: res.characters, unitKind: 'characters', success: true, requestId: input.requestId });
    await logSecurityEvent({ event: 'media.synthesized', userId: input.userId, actorUserId: input.userId, organizationId: input.organizationId, metadata: { mediaId: media.id, voice: voice.slug, characters: res.characters } });
    return { media, durationMs: res.durationMs };
  } catch (err) {
    await meterMedia({ operation: 'TEXT_TO_SPEECH', userId: input.userId, organizationId: input.organizationId, provider: provider.name, success: false, errorCode: 'TTS_FAILED', requestId: input.requestId });
    if (err instanceof MediaError) throw err;
    throw new MediaError('TTS_FAILED');
  }
}
