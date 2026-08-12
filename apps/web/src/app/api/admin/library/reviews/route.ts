import { requireAdmin } from '@/server/auth/guards';
import { handleError, ok } from '@/lib/api';
import { reviewQueue } from '@/server/library/review';

/** GET /api/admin/library/reviews — the pending review queue with validation + risk. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const queue = await reviewQueue();
    return ok({
      queue: queue.map((e) => ({
        reviewId: e.review.id,
        itemId: e.item.id,
        title: e.item.title,
        itemType: e.item.itemType,
        publisherType: e.item.publisherType,
        riskLevel: e.review.riskLevel,
        validation: e.review.validationResult,
        version: e.version ? { id: e.version.id, version: e.version.version, requiredTools: e.version.requiredTools, requiredConnectors: e.version.requiredConnectors, changeNotes: e.version.changeNotes } : null,
        createdAt: e.review.createdAt,
      })),
    });
  } catch (err) {
    return handleError(err, 'admin.library.reviews');
  }
}
