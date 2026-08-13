import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/server/auth/guards';
import { getDb } from '@/server/db';
import { scimConfigurations } from '@/server/db/schema';
import { handleError, ok, forbidden } from '@/lib/api';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { createScimToken } from '@/server/enterprise/scim';
import { scimEnabled } from '@/server/enterprise/config';

/** GET the SCIM config (never the token); POST to (re)generate a token — shown once. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'identity.read');
    const [cfg] = await getDb().select().from(scimConfigurations).where(eq(scimConfigurations.organizationId, access.organizationId)).limit(1);
    const base = new URL(req.url).origin;
    return ok({ enabled: cfg?.enabled ?? false, tokenPrefix: cfg?.tokenPrefix ?? null, tokenLastFour: cfg?.tokenLastFour ?? null, lastUsedAt: cfg?.lastUsedAt ?? null, scimBaseUrl: `${base}/api/scim/v2` });
  } catch (err) {
    return handleError(err, 'org.scim.get');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    if (!scimEnabled()) return forbidden('SCIM is not enabled.');
    const access = await requireOrgPermission(req, auth.user.id, 'identity.manage');
    const { token } = await createScimToken(access.organizationId, auth.user.id);
    return ok({ token }); // shown ONCE
  } catch (err) {
    return handleError(err, 'org.scim.create');
  }
}
