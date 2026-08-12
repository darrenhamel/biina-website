import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { mediaProcessingJobs } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { logSecurityEvent } from '@/server/auth/events';
import { getOcrProvider } from './providers';
import { readMediaBytes, type MediaAccess } from './service';
import { assertOcr, meterMedia } from './usage';
import { MediaError } from './errors';

/**
 * OCRService — explicit text extraction from images/scans. Distinct from general
 * vision. Prefers a deterministic OCR provider; a multimodal model is only a
 * fallback (configurable). Extracted text is UNTRUSTED content — callers must
 * frame it as data, never instructions (prompt-injection defense).
 */

export interface OcrOutput {
  text: string;
  language: string | null;
  confidence: number | null;
  pages: number;
}

export async function runOcr(input: { access: MediaAccess; userId: string; organizationId: string | null; plan: Plan; languageHint?: string; requestId?: string | null }): Promise<OcrOutput> {
  if (input.access.media.mediaType !== 'IMAGE') throw new MediaError('UNSUPPORTED_MEDIA');
  await assertOcr(input.plan, input.userId, 1);

  const bytes = await readMediaBytes(input.access.media);
  const provider = getOcrProvider();
  try {
    const res = await provider.extract({ bytes, mime: input.access.media.mimeType, languageHint: input.languageHint });
    await meterMedia({ operation: 'OCR', userId: input.userId, organizationId: input.organizationId, mediaAssetId: input.access.media.id, provider: provider.name, units: res.pages ?? 1, unitKind: 'pages', success: true, requestId: input.requestId });
    await logSecurityEvent({ event: 'media.ocr', userId: input.userId, actorUserId: input.userId, organizationId: input.organizationId, metadata: { mediaId: input.access.media.id, language: res.language, confidence: res.confidence } });
    return { text: res.text, language: res.language ?? null, confidence: res.confidence ?? null, pages: res.pages ?? 1 };
  } catch (err) {
    await meterMedia({ operation: 'OCR', userId: input.userId, organizationId: input.organizationId, mediaAssetId: input.access.media.id, provider: provider.name, success: false, errorCode: 'OCR_FAILED', requestId: input.requestId });
    if (err instanceof MediaError) throw err;
    throw new MediaError('OCR_FAILED');
  }
}

/** Durable job record for background OCR (idempotent per media). */
export async function ensureOcrJob(mediaAssetId: string): Promise<void> {
  await getDb().insert(mediaProcessingJobs).values({ mediaAssetId, jobType: 'OCR', status: 'QUEUED' }).onConflictDoNothing();
}

export async function completeJob(mediaAssetId: string, jobType: 'OCR' | 'TRANSCRIBE', ok: boolean, error?: string): Promise<void> {
  await getDb().update(mediaProcessingJobs).set({ status: ok ? 'READY' : 'FAILED', error: error ?? null, completedAt: new Date() }).where(eq(mediaProcessingJobs.mediaAssetId, mediaAssetId));
}
