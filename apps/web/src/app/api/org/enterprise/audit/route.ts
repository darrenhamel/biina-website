import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { queryAudit } from '@/server/enterprise/audit';

/** GET — filtered organization audit log (permission-gated; metadata only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'audit.read');
    const sp = new URL(req.url).searchParams;
    const rows = await queryAudit({
      organizationId: access.organizationId,
      event: sp.get('event') ?? undefined,
      actorUserId: sp.get('actor') ?? undefined,
      from: sp.get('from') ? new Date(sp.get('from')!) : undefined,
      to: sp.get('to') ? new Date(sp.get('to')!) : undefined,
      limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
    });
    return ok({ events: rows });
  } catch (err) {
    return handleError(err, 'org.audit.get');
  }
}
