import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { listNotifications, markNotificationsRead } from '@/server/workflows/notifications';

/** GET /api/notifications — the caller's automation notifications. POST — mark read. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const rows = await listNotifications(auth.user.id);
    return ok({ notifications: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, workflowId: n.workflowId, readAt: n.readAt, createdAt: n.createdAt })) });
  } catch (err) {
    return handleError(err, 'notifications.list');
  }
}

export async function POST(_req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    await markNotificationsRead(auth.user.id);
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'notifications.read');
  }
}
