import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { handleError, ok, notFound } from '@/lib/api';
import { resolveMediaAccess, readMediaBytes, deleteMedia } from '@/server/media/service';

/**
 * GET    /api/media/[id] — stream the bytes AFTER re-checking ownership/tenant (a
 *   known media id is never sufficient). Served as an attachment, never inline HTML.
 * DELETE /api/media/[id] — soft-delete + remove bytes (retention policy).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveMediaAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Media not found');
    const bytes = await readMediaBytes(access.media);
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': access.media.mimeType,
        'Content-Length': String(access.media.sizeBytes),
        'Content-Disposition': 'attachment', // never render inline as HTML
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return handleError(err, 'media.get');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const access = await resolveMediaAccess(auth.user.id, params.id, ws.organizationId);
    if (!access) return notFound('Media not found');
    await deleteMedia(access, auth.user.id);
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'media.delete');
  }
}
