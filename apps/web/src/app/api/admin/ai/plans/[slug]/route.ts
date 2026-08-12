import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { updatePlan } from '@/server/ai/plans';
import { updatePlanSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const slugSchema = z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN']);

export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const slug = slugSchema.parse(params.slug);
    const patch = updatePlanSchema.parse(await req.json());
    return NextResponse.json(await updatePlan(slug, patch, auth.user.id));
  } catch (err) {
    return handleError(err, 'admin.ai.plan.update');
  }
}
