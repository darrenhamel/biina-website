import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok, forbidden } from '@/lib/api';
import { libraryEnabled } from '@/server/library/config';
import { buildDiscovery } from '@/server/library/recommend';
import { getUserExperienceId } from '@/server/experience/service';

/** GET /api/library/discover — persona-aware featured / for-you / category sections. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const card = (i: { id: string; slug: string; itemType: string; title: string; titleAr: string | null; shortDescription: string; riskLevel: string; verified: boolean; featured: boolean; installationCount: number }) => ({
  id: i.id,
  slug: i.slug,
  itemType: i.itemType,
  title: i.title,
  titleAr: i.titleAr,
  shortDescription: i.shortDescription,
  riskLevel: i.riskLevel,
  verified: i.verified,
  featured: i.featured,
  installationCount: i.installationCount,
});

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    if (!libraryEnabled()) return forbidden('The library is not available.');
    const ws = await activeWorkspace(req, auth.user.id);
    const plan = await getPlan(auth.user.plan);
    const persona = await getUserExperienceId(auth.user.id);
    const locale = new URL(req.url).searchParams.get('locale') === 'ar' ? 'ar' : 'en';
    const { featured, forYou, sections } = await buildDiscovery({ userId: auth.user.id, activeOrganizationId: ws.organizationId }, persona, plan, locale);
    return ok({
      persona: persona ?? 'default',
      featured: featured.map(card),
      forYou: forYou.map((r) => ({ ...card(r.item), reason: r.reason })),
      sections: sections.map((s) => ({ key: s.key, items: s.items.map(card) })),
    });
  } catch (err) {
    return handleError(err, 'library.discover');
  }
}
