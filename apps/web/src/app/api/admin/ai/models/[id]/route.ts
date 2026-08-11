import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { updateModel } from '@/server/ai/admin';
import { updateModelSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const patch = updateModelSchema.parse(await req.json());
    return NextResponse.json(await updateModel(id, patch, auth.user.id));
  } catch (err) {
    return handleError(err, 'admin.ai.model.update');
  }
}
