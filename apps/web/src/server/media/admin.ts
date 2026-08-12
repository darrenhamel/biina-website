import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { mediaUsageEvents, mediaAssets } from '@/server/db/schema';
import { getVisionProvider, getOcrProvider, getSttProvider, getTtsProvider } from './providers';
import { getFileStorage } from '@/server/rag/storage';

/**
 * Admin multimodal control/health — operational metadata + provider health only.
 * Never exposes private media content. Provider selection is admin/config; secrets
 * stay server-side.
 */

export async function multimodalOverview(): Promise<{
  providers: { vision: string; ocr: string; stt: string; tts: string };
  health: { vision: boolean; ocr: boolean; stt: boolean; tts: boolean; storage: boolean };
  usage: { vision: number; ocr: number; sttSeconds: number; ttsCharacters: number; voiceSessions: number };
  errors: number;
  estimatedCost: number;
  mediaAssets: number;
}> {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const sumWhere = (op: string) => and(eq(mediaUsageEvents.operation, op), eq(mediaUsageEvents.success, true), gte(mediaUsageEvents.createdAt, since));
  const sumUnits = async (op: string) => (await db.select({ n: sql<number>`coalesce(sum(${mediaUsageEvents.units}),0)::int` }).from(mediaUsageEvents).where(sumWhere(op)))[0]?.n ?? 0;

  const [vision, ocr, stt, tts, voice, errors, cost, assets, vh, oh, sh, th, storeH] = await Promise.all([
    sumUnits('VISION'),
    sumUnits('OCR'),
    sumUnits('SPEECH_TO_TEXT'),
    sumUnits('TEXT_TO_SPEECH'),
    sumUnits('VOICE_SESSION'),
    db.select({ n: sql<number>`count(*)::int` }).from(mediaUsageEvents).where(and(eq(mediaUsageEvents.success, false), gte(mediaUsageEvents.createdAt, since))),
    db.select({ n: sql<number>`coalesce(sum(${mediaUsageEvents.estimatedCost}),0)` }).from(mediaUsageEvents).where(gte(mediaUsageEvents.createdAt, since)),
    db.select({ n: sql<number>`count(*)::int` }).from(mediaAssets).where(sql`${mediaAssets.status} <> 'DELETED'`),
    getVisionProvider().health().catch(() => ({ ok: false })),
    getOcrProvider().health().catch(() => ({ ok: false })),
    getSttProvider().health().catch(() => ({ ok: false })),
    getTtsProvider().health().catch(() => ({ ok: false })),
    getFileStorage().health().catch(() => ({ ok: false })),
  ]);

  return {
    providers: { vision: getVisionProvider().name, ocr: getOcrProvider().name, stt: getSttProvider().name, tts: getTtsProvider().name },
    health: { vision: vh.ok, ocr: oh.ok, stt: sh.ok, tts: th.ok, storage: storeH.ok },
    usage: { vision, ocr, sttSeconds: stt, ttsCharacters: tts, voiceSessions: voice },
    errors: errors[0]?.n ?? 0,
    estimatedCost: Math.round(Number(cost[0]?.n ?? 0) * 10000) / 10000,
    mediaAssets: assets[0]?.n ?? 0,
  };
}
