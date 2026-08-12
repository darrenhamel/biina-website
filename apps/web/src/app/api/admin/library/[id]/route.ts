import { NextRequest } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok, badRequest } from '@/lib/api';
import { deprecateItem, suspendItem } from '@/server/library/review';

/** POST /api/admin/library/[id] — platform revocation: suspend or deprecate an item. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
    if (body.action === 'suspend') {
      await suspendItem(params.id, auth.user.id, body.reason);
      return ok({ ok: true, status: 'SUSPENDED' });
    }
    if (body.action === 'deprecate') {
      await deprecateItem(params.id, auth.user.id);
      return ok({ ok: true, status: 'DEPRECATED' });
    }
    return badRequest('Unknown action. Use "suspend" or "deprecate".');
  } catch (err) {
    return handleError(err, 'admin.library.suspend');
  }
}
