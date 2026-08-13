import { requireAdmin } from '@/server/auth/guards';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { deploymentProfiles, organizations, organizationIdentityProviders, verifiedDomains, aiProviders } from '@/server/db/schema';
import { handleError, ok } from '@/lib/api';
import { enterpriseFeaturesEnabled, samlEnabled, scimEnabled, sovereignModeEnabled, dedicatedProviderSupportEnabled } from '@/server/enterprise/config';

/** GET — platform enterprise overview (counts + flags). No tenant secrets. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const db = getDb();
    const n = async (q: Promise<Array<{ c: number }>>) => (await q)[0]?.c ?? 0;
    const [profiles, orgs, idps, domains, privateProviders] = await Promise.all([
      db.select().from(deploymentProfiles),
      n(db.select({ c: sql<number>`count(*)::int` }).from(organizations)),
      n(db.select({ c: sql<number>`count(*)::int` }).from(organizationIdentityProviders)),
      n(db.select({ c: sql<number>`count(*)::int` }).from(verifiedDomains).where(sql`status = 'VERIFIED'`)),
      n(db.select({ c: sql<number>`count(*)::int` }).from(aiProviders).where(sql`owner_type = 'ORGANIZATION'`)),
    ]);
    return ok({
      flags: { enterpriseFeatures: enterpriseFeaturesEnabled(), saml: samlEnabled(), scim: scimEnabled(), sovereignMode: sovereignModeEnabled(), dedicatedProviders: dedicatedProviderSupportEnabled() },
      deploymentProfiles: profiles.map((p) => ({ id: p.id, slug: p.slug, displayName: p.displayName, deploymentType: p.deploymentType, region: p.region, privileged: p.privileged, enabled: p.enabled })),
      counts: { organizations: orgs, identityProviders: idps, verifiedDomains: domains, privateProviders },
    });
  } catch (err) {
    return handleError(err, 'admin.enterprise.overview');
  }
}
