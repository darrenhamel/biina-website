import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { mediaUsageEvents } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { MediaError } from './errors';

/**
 * Multimodal usage metering + entitlement/quota gates. Metered separately from the
 * AI text ledger (no double-counting): each operation records provider-reported
 * units only (images / pixels / seconds / characters) — never invented units.
 */

export type MediaOperation = 'VISION' | 'OCR' | 'SPEECH_TO_TEXT' | 'TEXT_TO_SPEECH' | 'VOICE_SESSION';

export async function meterMedia(entry: {
  operation: MediaOperation;
  userId: string;
  organizationId: string | null;
  mediaAssetId?: string | null;
  provider?: string;
  units?: number;
  unitKind?: string;
  estimatedCost?: number;
  success: boolean;
  errorCode?: string;
  requestId?: string | null;
}): Promise<void> {
  try {
    await getDb().insert(mediaUsageEvents).values({
      operation: entry.operation,
      userId: entry.userId,
      organizationId: entry.organizationId,
      mediaAssetId: entry.mediaAssetId ?? null,
      provider: entry.provider,
      units: entry.units,
      unitKind: entry.unitKind,
      estimatedCost: entry.estimatedCost,
      success: entry.success,
      errorCode: entry.errorCode,
      requestId: entry.requestId ?? null,
    });
  } catch (e) {
    logger.warn('media.meter.failed', { error: String(e) });
  }
}

async function sumUnits(userId: string, operation: MediaOperation, since: Date): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`coalesce(sum(${mediaUsageEvents.units}),0)::int` })
    .from(mediaUsageEvents)
    .where(and(eq(mediaUsageEvents.userId, userId), eq(mediaUsageEvents.operation, operation), eq(mediaUsageEvents.success, true), gte(mediaUsageEvents.createdAt, since)));
  return r?.n ?? 0;
}

const startOfDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
const startOfMonth = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

/** Vision: entitlement + per-image-count-per-request + per-day upload count. */
export async function assertVision(plan: Plan, userId: string, imageCount: number): Promise<void> {
  if (!plan.visionEnabled) throw new MediaError('NOT_ENTITLED');
  if (plan.maxImagesPerRequest != null && imageCount > plan.maxImagesPerRequest) throw new MediaError('QUOTA_EXCEEDED', { scope: 'per_request', max: plan.maxImagesPerRequest });
  if (plan.imageUploadsPerDay != null && (await sumUnits(userId, 'VISION', startOfDay())) + imageCount > plan.imageUploadsPerDay) throw new MediaError('QUOTA_EXCEEDED', { scope: 'day' });
}

export async function assertOcr(plan: Plan, userId: string, pages = 1): Promise<void> {
  if (!plan.ocrEnabled) throw new MediaError('NOT_ENTITLED');
  if (plan.ocrPagesPerMonth != null && (await sumUnits(userId, 'OCR', startOfMonth())) + pages > plan.ocrPagesPerMonth) throw new MediaError('QUOTA_EXCEEDED', { scope: 'month' });
}

export async function assertStt(plan: Plan, userId: string, seconds: number): Promise<void> {
  if (!plan.speechToTextEnabled) throw new MediaError('NOT_ENTITLED');
  if (plan.audioMinutesPerMonth != null && (await sumUnits(userId, 'SPEECH_TO_TEXT', startOfMonth())) + seconds > plan.audioMinutesPerMonth * 60) throw new MediaError('QUOTA_EXCEEDED', { scope: 'month' });
}

export async function assertTts(plan: Plan, userId: string, characters: number): Promise<void> {
  if (!plan.textToSpeechEnabled) throw new MediaError('NOT_ENTITLED');
  if (plan.ttsCharactersPerMonth != null && (await sumUnits(userId, 'TEXT_TO_SPEECH', startOfMonth())) + characters > plan.ttsCharactersPerMonth) throw new MediaError('QUOTA_EXCEEDED', { scope: 'month' });
}
