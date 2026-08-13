import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok, forbidden } from '@/lib/api';
import { privateProviderSchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { createPrivateProvider, orgProviderHealth } from '@/server/enterprise/providers';
import { getPlan } from '@/server/ai/plans';
import { dedicatedProviderSupportEnabled } from '@/server/enterprise/config';

/** GET org private-provider health; POST to register a dedicated/private provider. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'ai_models.read');
    const health = await orgProviderHealth(access.organizationId);
    return ok({ providers: health });
  } catch (err) {
    return handleError(err, 'org.providers.get');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    if (!dedicatedProviderSupportEnabled()) return forbidden('Dedicated providers are not enabled.');
    const access = await requireOrgPermission(req, auth.user.id, 'ai_models.manage');
    const plan = await getPlan(auth.user.plan);
    if (!plan.dedicatedProviderAllowed) return forbidden('Your plan does not include dedicated providers.');
    const input = privateProviderSchema.parse(await req.json());
    const provider = await createPrivateProvider({ organizationId: access.organizationId, ...input }, auth.user.id);
    // Never return credential refs to the browser.
    return ok({ provider: { id: provider.id, slug: provider.slug, displayName: provider.displayName, region: provider.region, isExternal: provider.isExternal } });
  } catch (err) {
    return handleError(err, 'org.providers.create');
  }
}
