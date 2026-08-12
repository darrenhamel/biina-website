import { NextRequest } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { reviewDecisionSchema } from '@/lib/validation';
import { decideReview } from '@/server/library/review';

/** POST /api/admin/library/reviews/[id] — approve / reject / request changes / suspend. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const { action, notes } = reviewDecisionSchema.parse(await req.json());
    const res = await decideReview(params.id, action, auth.user.id, notes);
    return ok(res);
  } catch (err) {
    return handleError(err, 'admin.library.review.decide');
  }
}
