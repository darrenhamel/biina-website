import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getCurrentUser } from '@/server/auth/session';
import { getDb } from '@/server/db';
import { profiles } from '@/server/db/schema';
import { updateProfileSchema } from '@/lib/validation';
import { ok, unauthorized, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const patch = updateProfileSchema.parse(await req.json());

    await getDb()
      .update(profiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(profiles.userId, user.id));

    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'profile.update');
  }
}
