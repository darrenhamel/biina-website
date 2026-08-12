import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { assignPlan } from '@/server/ai/plans';
import { assignPlanSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** PUT /api/admin/ai/users/[id]/plan — assign a plan to a user (ADMIN only, audited). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const { plan, note, endsAt } = assignPlanSchema.parse(await req.json());
    return NextResponse.json(await assignPlan(id, plan, auth.user.id, { note, endsAt }));
  } catch (err) {
    return handleError(err, 'admin.ai.user.plan');
  }
}
