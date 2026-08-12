import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { messages } from '@/server/db/schema';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { ttsRequestSchema } from '@/lib/validation';
import { handleError, ok, badRequest } from '@/lib/api';
import { isMediaError } from '@/server/media/errors';
import { getOwnedConversation } from '@/server/conversations';
import { synthesizeSpeech } from '@/server/media/tts';

/**
 * POST /api/tts — synthesize an assistant response (or provided text) to speech.
 * Opt-in (read-aloud / voice mode), never automatic. Returns a media id scoped to
 * the requesting user/workspace. If a messageId is given, its conversation ownership
 * is verified before reading the text.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { text, messageId, voiceSlug, language } = ttsRequestSchema.parse(await req.json());
    const ws = await activeWorkspace(req, auth.user.id);

    let toSpeak = text ?? '';
    if (messageId) {
      const [m] = await getDb().select().from(messages).where(eq(messages.id, messageId)).limit(1);
      if (!m) return badRequest('Message not found');
      const owned = await getOwnedConversation(auth.user.id, m.conversationId); // ownership check
      if (!owned) return badRequest('Message not found');
      toSpeak = m.content;
    }
    if (!toSpeak.trim()) return badRequest('Nothing to synthesize');

    const plan = await getPlan(auth.user.plan);
    const { media, durationMs } = await synthesizeSpeech({ text: toSpeak, voiceSlug, language, userId: auth.user.id, organizationId: ws.organizationId, plan });
    return ok({ ok: true, mediaId: media.id, durationMs, mimeType: media.mimeType });
  } catch (err) {
    if (isMediaError(err)) return NextResponse.json({ error: err.message, code: err.code, ...(err.data ? { data: err.data } : {}) }, { status: err.status });
    return handleError(err, 'media.tts');
  }
}
