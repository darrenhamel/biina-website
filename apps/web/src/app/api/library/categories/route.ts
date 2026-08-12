import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { listCategories } from '@/server/library/catalog';
import { getUserExperienceId } from '@/server/experience/service';

/** GET /api/library/categories — discovery categories for the caller's persona. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const personaParam = new URL(req.url).searchParams.get('persona');
    const persona = personaParam ?? (await getUserExperienceId(auth.user.id));
    const rows = await listCategories(persona);
    return ok({ categories: rows.map((c) => ({ slug: c.slug, labelEn: c.labelEn, labelAr: c.labelAr, personaScopes: c.personaScopes })) });
  } catch (err) {
    return handleError(err, 'library.categories');
  }
}
