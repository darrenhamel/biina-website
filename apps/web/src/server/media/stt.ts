import { getDb } from '@/server/db';
import { audioTranscripts } from '@/server/db/schema';
import type { Plan, AudioTranscript } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { getSttProvider } from './providers';
import { readMediaBytes, type MediaAccess } from './service';
import { assertStt, meterMedia } from './usage';
import { MediaError } from './errors';

/**
 * SpeechToText — transcribes an audio asset into normalized text + segments. The
 * transcript is stored (tied to the media) and returned; transcribed speech passes
 * the same request-processing controls as typed text. Raw audio retention is a
 * separate policy (the transcript, not the audio, is what conversations persist).
 */

export async function transcribeMedia(input: { access: MediaAccess; userId: string; organizationId: string | null; plan: Plan; language?: string; timestamps?: boolean; requestId?: string | null }): Promise<AudioTranscript> {
  if (input.access.media.mediaType !== 'AUDIO') throw new MediaError('UNSUPPORTED_MEDIA');
  const estSeconds = Math.ceil((input.access.media.durationMs ?? 60_000) / 1000);
  await assertStt(input.plan, input.userId, estSeconds);

  const bytes = await readMediaBytes(input.access.media);
  const provider = getSttProvider();
  try {
    const res = await provider.transcribe({ bytes, mime: input.access.media.mimeType, language: input.language, timestamps: input.timestamps });
    const seconds = Math.ceil((res.durationMs ?? input.access.media.durationMs ?? estSeconds * 1000) / 1000);
    const [row] = await getDb()
      .insert(audioTranscripts)
      .values({ mediaAssetId: input.access.media.id, text: res.text.slice(0, 200_000), language: res.language ?? null, segments: res.segments ?? null, durationMs: res.durationMs ?? input.access.media.durationMs ?? null, confidence: res.confidence ?? null })
      .onConflictDoUpdate({ target: audioTranscripts.mediaAssetId, set: { text: res.text.slice(0, 200_000), language: res.language ?? null, segments: res.segments ?? null } })
      .returning();
    await meterMedia({ operation: 'SPEECH_TO_TEXT', userId: input.userId, organizationId: input.organizationId, mediaAssetId: input.access.media.id, provider: provider.name, units: seconds, unitKind: 'seconds', success: true, requestId: input.requestId });
    await logSecurityEvent({ event: 'media.transcribed', userId: input.userId, actorUserId: input.userId, organizationId: input.organizationId, metadata: { mediaId: input.access.media.id, language: res.language, seconds } });
    return row;
  } catch (err) {
    await meterMedia({ operation: 'SPEECH_TO_TEXT', userId: input.userId, organizationId: input.organizationId, mediaAssetId: input.access.media.id, provider: provider.name, success: false, errorCode: 'TRANSCRIPTION_FAILED', requestId: input.requestId });
    if (err instanceof MediaError) throw err;
    throw new MediaError('TRANSCRIPTION_FAILED');
  }
}
