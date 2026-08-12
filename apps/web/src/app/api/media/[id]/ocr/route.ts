import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok, notFound } from '@/lib/api';
import { isMediaError } from '@/server/media/errors';
import { resolveMediaAccess } from '@/server/media/service';
import { runOcr } from '@/server/media/ocr';

/** POST /api/media/[id]/ocr — extract text (untrusted) from an image. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveMediaAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Media not found');
    const plan = await getPlan(auth.user.plan);
    const out = await runOcr({ access, userId: auth.user.id, organizationId: ws.organizationId, plan });
    return ok({ ok: true, text: out.text, language: out.language, confidence: out.confidence, pages: out.pages });
  } catch (err) {
    if (isMediaError(err)) return NextResponse.json({ error: err.message, code: err.code, ...(err.data ? { data: err.data } : {}) }, { status: err.status });
    return handleError(err, 'media.ocr');
  }
}
