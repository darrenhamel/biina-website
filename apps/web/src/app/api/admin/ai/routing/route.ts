import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { updateRouting } from '@/server/ai/admin';
import { updateRoutingSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const patch = updateRoutingSchema.parse(await req.json());
    return NextResponse.json(await updateRouting(patch, auth.user.id));
  } catch (err) {
    return handleError(err, 'admin.ai.routing.update');
  }
}
