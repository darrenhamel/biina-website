import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { listPlans } from '@/server/ai/plans';
import { handleError } from '@/lib/api';

/** GET /api/admin/ai/plans — list plan definitions (ADMIN only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ plans: await listPlans() });
  } catch (err) {
    return handleError(err, 'admin.ai.plans');
  }
}
