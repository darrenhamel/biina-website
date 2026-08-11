import { destroyCurrentSession } from '@/server/auth/session';
import { ok, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await destroyCurrentSession();
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.logout');
  }
}
