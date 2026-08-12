import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { libraryItems, libraryReviews } from '@/server/db/schema';
import type { LibraryItem, LibraryItemVersion, LibraryReview } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';
import { getVersion, publishVersion, versionEscalation } from './versions';
import { isExecutableType, type LibraryItemType } from './types';
import { RISK_ORDER } from './types';
import { publicCreatorPublishingEnabled } from './config';

/**
 * Publishing lifecycle + moderation. Executable items (agents/workflows) are NEVER
 * auto-published from AI review: they require deterministic validation to pass AND a
 * human/admin decision. Content-only BIINA items may be published directly by the
 * platform. Deterministic validation is the gate that cannot be skipped.
 */

/** Submit a DRAFT version for review. Runs deterministic validation (already stored). */
export async function submitForReview(item: LibraryItem, version: LibraryItemVersion, actorUserId: string): Promise<LibraryReview> {
  // Non-BIINA submissions require the creator-publishing switch (off by default).
  if (item.publisherType !== 'BIINA' && !publicCreatorPublishingEnabled()) {
    throw new AppError(403, 'Public creator publishing is not enabled.', 'creator_publishing_disabled');
  }
  const validation = (version.validationResult ?? {}) as { ok?: boolean; riskLevel?: string };
  const db = getDb();
  await db.update(libraryItems).set({ status: 'SUBMITTED', updatedAt: new Date() }).where(eq(libraryItems.id, item.id));
  const [review] = await db
    .insert(libraryReviews)
    .values({
      libraryItemId: item.id,
      versionId: version.id,
      status: 'PENDING',
      riskLevel: version.riskLevel,
      validationResult: version.validationResult ?? null,
    })
    .returning();
  await logSecurityEvent({ event: 'library.submitted', userId: actorUserId, organizationId: item.publisherOrganizationId ?? null, metadata: { itemId: item.id, versionId: version.id, valid: validation.ok === true, risk: version.riskLevel } });
  return review;
}

export interface ReviewQueueEntry {
  review: LibraryReview;
  item: LibraryItem;
  version: LibraryItemVersion | null;
}

/** Admin review queue — pending submissions with their validation + risk metadata. */
export async function reviewQueue(): Promise<ReviewQueueEntry[]> {
  const db = getDb();
  const reviews = await db.select().from(libraryReviews).where(eq(libraryReviews.status, 'PENDING')).orderBy(desc(libraryReviews.createdAt)).limit(100);
  const out: ReviewQueueEntry[] = [];
  for (const review of reviews) {
    const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, review.libraryItemId)).limit(1);
    const version = review.versionId ? await getVersion(review.versionId) : null;
    if (item) out.push({ review, item, version });
  }
  return out;
}

export type ReviewAction = 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES' | 'SUSPEND';

/** An admin decision on a submitted version. APPROVE publishes; others update status. */
export async function decideReview(reviewId: string, action: ReviewAction, adminUserId: string, notes?: string): Promise<{ ok: true; published: boolean }> {
  const db = getDb();
  const [review] = await db.select().from(libraryReviews).where(eq(libraryReviews.id, reviewId)).limit(1);
  if (!review) throw new AppError(404, 'Review not found.', 'review_not_found');
  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, review.libraryItemId)).limit(1);
  if (!item) throw new AppError(404, 'Item not found.', 'item_not_found');
  const version = review.versionId ? await getVersion(review.versionId) : null;
  const now = new Date();

  if (action === 'APPROVE') {
    if (!version) throw new AppError(400, 'No version to approve.', 'no_version');
    const validation = (version.validationResult ?? {}) as { ok?: boolean };
    // Deterministic validation is a hard gate — a human cannot approve an item that
    // fails structural validation.
    if (validation.ok === false) throw new AppError(422, 'This version fails automated validation and cannot be approved.', 'validation_failed');
    if (RISK_ORDER[version.riskLevel as keyof typeof RISK_ORDER] > RISK_ORDER.SCHEDULED_WRITE) {
      throw new AppError(422, 'High-risk items cannot be published in this phase.', 'risk_too_high');
    }
    await db.update(libraryReviews).set({ status: 'APPROVED', reviewerUserId: adminUserId, notes: notes ?? null, decidedAt: now }).where(eq(libraryReviews.id, reviewId));
    await publishVersion(item, version);
    if (item.publisherType === 'BIINA') await db.update(libraryItems).set({ verified: true }).where(eq(libraryItems.id, item.id));
    await logSecurityEvent({ event: 'library.approved', actorUserId: adminUserId, organizationId: item.publisherOrganizationId ?? null, metadata: { itemId: item.id, versionId: version.id } });
    await logSecurityEvent({ event: 'library.published', actorUserId: adminUserId, metadata: { itemId: item.id, versionId: version.id, risk: version.riskLevel } });
    return { ok: true, published: true };
  }

  const statusMap = { REJECT: 'REJECTED', REQUEST_CHANGES: 'CHANGES_REQUESTED', SUSPEND: 'SUSPENDED' } as const;
  const itemStatusMap = { REJECT: 'REJECTED', REQUEST_CHANGES: 'DRAFT', SUSPEND: 'SUSPENDED' } as const;
  await db.update(libraryReviews).set({ status: statusMap[action], reviewerUserId: adminUserId, notes: notes ?? null, decidedAt: now }).where(eq(libraryReviews.id, reviewId));
  await db.update(libraryItems).set({ status: itemStatusMap[action], updatedAt: now }).where(eq(libraryItems.id, item.id));
  const eventMap = { REJECT: 'library.rejected', REQUEST_CHANGES: 'library.changes_requested', SUSPEND: 'library.suspended' } as const;
  await logSecurityEvent({ event: eventMap[action], actorUserId: adminUserId, organizationId: item.publisherOrganizationId ?? null, metadata: { itemId: item.id, notes: notes?.slice(0, 200) } });
  return { ok: true, published: false };
}

/** Suspend an already-published item platform-wide (revocation). */
export async function suspendItem(itemId: string, adminUserId: string, reason?: string): Promise<void> {
  const db = getDb();
  await db.update(libraryItems).set({ status: 'SUSPENDED', updatedAt: new Date() }).where(eq(libraryItems.id, itemId));
  await logSecurityEvent({ event: 'library.suspended', actorUserId: adminUserId, metadata: { itemId, reason: reason?.slice(0, 200) } });
}

/** Deprecate (non-destructive) — no new installs, existing installs keep working. */
export async function deprecateItem(itemId: string, adminUserId: string): Promise<void> {
  await getDb().update(libraryItems).set({ status: 'DEPRECATED', updatedAt: new Date() }).where(eq(libraryItems.id, itemId));
  await logSecurityEvent({ event: 'library.deprecated', actorUserId: adminUserId, metadata: { itemId } });
}

/**
 * A BIINA-owned content item can be published directly (still validated). Executable
 * types always route through review even for BIINA. Used by the curated seeder + admin.
 */
export async function publishDirect(item: LibraryItem, version: LibraryItemVersion, adminUserId: string): Promise<void> {
  if (isExecutableType(item.itemType as LibraryItemType)) {
    const validation = (version.validationResult ?? {}) as { ok?: boolean };
    if (validation.ok === false) throw new AppError(422, 'Version fails validation.', 'validation_failed');
  }
  await publishVersion(item, version);
  await logSecurityEvent({ event: 'library.published', actorUserId: adminUserId, metadata: { itemId: item.id, versionId: version.id } });
  void versionEscalation;
}
