import { requireUser } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { listVoices } from '@/server/media/voices';

/** GET /api/voices — the enabled BIINA voice identities (no provider voice ids). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const voices = await listVoices();
    return ok({ voices: voices.map((v) => ({ slug: v.slug, displayName: v.displayName, language: v.language, locale: v.locale })) });
  } catch (err) {
    return handleError(err, 'voices.list');
  }
}
