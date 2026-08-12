import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { memorySettingsSchema } from '@/lib/validation';
import { handleError, ok } from '@/lib/api';
import { getMemorySettings, updateMemorySettings } from '@/server/memory/consent';

/** GET/PATCH /api/memory/settings — memory consent + personalization preferences. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    return ok({ settings: await getMemorySettings(auth.user.id) });
  } catch (err) {
    return handleError(err, 'memory.settings.get');
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const patch = memorySettingsSchema.parse(await req.json());
    await updateMemorySettings(auth.user.id, patch);
    return ok({ ok: true, settings: await getMemorySettings(auth.user.id) });
  } catch (err) {
    return handleError(err, 'memory.settings.set');
  }
}
