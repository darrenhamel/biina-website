import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/server/auth/guards';
import { getDb } from '@/server/db';
import { organizationIdentityProviders } from '@/server/db/schema';
import { handleError, ok } from '@/lib/api';
import { identityProviderSchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { logSecurityEvent } from '@/server/auth/events';

/** GET/POST the organization's enterprise identity providers (secrets are refs only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const redact = (r: typeof organizationIdentityProviders.$inferSelect) => ({
  id: r.id,
  type: r.type,
  displayName: r.displayName,
  enabled: r.enabled,
  issuer: r.issuer,
  enforceSSO: r.enforceSSO,
  allowPasswordFallback: r.allowPasswordFallback,
  domainRestriction: r.domainRestriction,
  spEntityId: r.spEntityId,
  acsUrl: r.acsUrl,
  // NEVER return clientSecretRef/idpCertRef values — they are env references, but we
  // still keep them server-side only.
});

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'identity.read');
    const rows = await getDb().select().from(organizationIdentityProviders).where(eq(organizationIdentityProviders.organizationId, access.organizationId));
    return ok({ providers: rows.map(redact) });
  } catch (err) {
    return handleError(err, 'org.identity.get');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'identity.manage');
    const input = identityProviderSchema.parse(await req.json());
    const [row] = await getDb()
      .insert(organizationIdentityProviders)
      .values({ organizationId: access.organizationId, ...input, attributeMappings: input.attributeMappings ?? {}, domainRestriction: input.domainRestriction ?? [] })
      .returning();
    await logSecurityEvent({ event: 'enterprise.idp_changed', actorUserId: auth.user.id, organizationId: access.organizationId, metadata: { type: input.type } });
    return ok({ provider: redact(row) });
  } catch (err) {
    return handleError(err, 'org.identity.create');
  }
}
