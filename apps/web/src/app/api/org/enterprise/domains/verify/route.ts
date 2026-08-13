import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { claimDomainSchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { verifyDomain } from '@/server/enterprise/domains';

/** POST — verify a claimed domain by checking its DNS TXT record. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'identity.manage');
    const { domain } = claimDomainSchema.parse(await req.json());
    const row = await verifyDomain(access.organizationId, domain, auth.user.id);
    return ok({ domain: { id: row.id, domain: row.domain, status: row.status, verifiedAt: row.verifiedAt } });
  } catch (err) {
    return handleError(err, 'org.domains.verify');
  }
}
