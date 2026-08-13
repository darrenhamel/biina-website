import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { claimDomainSchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { claimDomain, listDomains } from '@/server/enterprise/domains';

/** GET domains for the org; POST to claim a domain (returns the DNS TXT record once). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'identity.read');
    const rows = await listDomains(access.organizationId);
    return ok({ domains: rows.map((d) => ({ id: d.id, domain: d.domain, status: d.status, verifiedAt: d.verifiedAt })) });
  } catch (err) {
    return handleError(err, 'org.domains.get');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'identity.manage');
    const { domain } = claimDomainSchema.parse(await req.json());
    const res = await claimDomain(access.organizationId, domain, auth.user.id);
    // The token/txtRecord are shown ONCE so the admin can publish the DNS record.
    return ok({ domain: { id: res.domain.id, domain: res.domain.domain, status: res.domain.status }, txtRecord: res.txtRecord });
  } catch (err) {
    return handleError(err, 'org.domains.claim');
  }
}
