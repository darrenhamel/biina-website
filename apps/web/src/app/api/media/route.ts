import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok } from '@/lib/api';
import { multimodalEnabled } from '@/server/media/config';
import { isMediaError } from '@/server/media/errors';
import { uploadMedia } from '@/server/media/service';

/**
 * POST /api/media — upload an image/audio asset (multipart form field "file", or a
 * raw body). Validated server-side (magic bytes, size, dimensions); stored as opaque
 * bytes; tenant-scoped. Returns a media id the chat/TTS/OCR APIs reference.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 45 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    if (!multimodalEnabled()) return NextResponse.json({ error: 'Multimodal is disabled.' }, { status: 403 });
    const ws = await activeWorkspace(req, auth.user.id);
    const plan = await getPlan(auth.user.plan);

    let bytes: Buffer;
    let declaredMime: string | undefined;
    let conversationId: string | null = null;
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
      if (file.size > MAX) return NextResponse.json({ error: 'File too large.' }, { status: 413 });
      bytes = Buffer.from(await file.arrayBuffer());
      declaredMime = file.type || undefined;
      const conv = form.get('conversationId');
      if (typeof conv === 'string' && /^[0-9a-f-]{36}$/i.test(conv)) conversationId = conv;
    } else {
      const ab = await req.arrayBuffer();
      if (ab.byteLength > MAX) return NextResponse.json({ error: 'File too large.' }, { status: 413 });
      bytes = Buffer.from(ab);
      declaredMime = contentType || undefined;
    }

    const media = await uploadMedia({ bytes, declaredMime, userId: auth.user.id, organizationId: ws.organizationId, conversationId, plan });
    return ok({ ok: true, media: { id: media.id, mediaType: media.mediaType, mimeType: media.mimeType, sizeBytes: media.sizeBytes, width: media.width, height: media.height } });
  } catch (err) {
    if (isMediaError(err)) return NextResponse.json({ error: err.message, code: err.code, ...(err.data ? { data: err.data } : {}) }, { status: err.status });
    return handleError(err, 'media.upload');
  }
}
