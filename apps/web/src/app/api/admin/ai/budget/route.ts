import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { updateBudget } from '@/server/ai/admin';
import { updateBudgetSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** PUT /api/admin/ai/budget — set platform budget thresholds (ADMIN only, audited). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const patch = updateBudgetSchema.parse(await req.json());
    return NextResponse.json(await updateBudget(patch, auth.user.id));
  } catch (err) {
    return handleError(err, 'admin.ai.budget');
  }
}
