import { NextRequest } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { getDb } from '@/server/db';
import { deploymentProfiles } from '@/server/db/schema';
import { handleError, ok } from '@/lib/api';
import { deploymentProfileSchema } from '@/lib/validation';
import { listDeploymentProfiles } from '@/server/enterprise/deployment';
import { normalizeRegion } from '@/server/enterprise/regions';

/** Platform admin: list/create deployment profiles (privileged profiles are platform-only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return ok({ profiles: await listDeploymentProfiles() });
  } catch (err) {
    return handleError(err, 'admin.deployment_profiles.get');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const input = deploymentProfileSchema.parse(await req.json());
    const [row] = await getDb()
      .insert(deploymentProfiles)
      .values({
        slug: input.slug,
        displayName: input.displayName,
        deploymentType: input.deploymentType,
        region: normalizeRegion(input.region),
        jurisdictionLabel: input.jurisdictionLabel ?? null,
        tenantIsolationMode: input.tenantIsolationMode ?? 'SHARED_DATABASE_TENANT_ISOLATION',
        allowedProviderRegions: input.allowedProviderRegions ?? [],
        externalAIAllowed: input.externalAIAllowed ?? true,
        externalWebSearchAllowed: input.externalWebSearchAllowed ?? true,
        externalConnectorsAllowed: input.externalConnectorsAllowed ?? true,
        privateStorageRequired: input.privateStorageRequired ?? false,
        privateVectorStoreRequired: input.privateVectorStoreRequired ?? false,
        privileged: input.privileged ?? (input.deploymentType === 'SOVEREIGN' || input.deploymentType === 'PRIVATE_CLOUD' || input.deploymentType === 'DEDICATED_TENANT'),
      })
      .returning();
    return ok({ profile: row });
  } catch (err) {
    return handleError(err, 'admin.deployment_profiles.create');
  }
}
