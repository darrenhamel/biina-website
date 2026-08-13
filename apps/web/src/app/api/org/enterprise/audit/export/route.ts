import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError } from '@/lib/api';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { exportAudit } from '@/server/enterprise/audit';

/** GET — export the org audit log as CSV or JSON (audit.read; no secrets, no content). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'audit.read');
    const sp = new URL(req.url).searchParams;
    const format = sp.get('format') === 'json' ? 'json' : 'csv';
    const out = await exportAudit(
      { organizationId: access.organizationId, from: sp.get('from') ? new Date(sp.get('from')!) : undefined, to: sp.get('to') ? new Date(sp.get('to')!) : undefined },
      format,
      auth.user.id,
    );
    return new NextResponse(out.body, { headers: { 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.filename}"` } });
  } catch (err) {
    return handleError(err, 'org.audit.export');
  }
}
