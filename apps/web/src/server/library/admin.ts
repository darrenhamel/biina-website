import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { libraryInstallations, libraryItems, libraryReviews } from '@/server/db/schema';
import { libraryEnabled, publicLibraryEnabled, publicCreatorPublishingEnabled, paidMarketplaceEnabled } from './config';

/** Admin library observability — operational metadata only, no private item content. */
export async function libraryOverview(): Promise<{
  killSwitches: { library: boolean; publicLibrary: boolean; creatorPublishing: boolean; paidMarketplace: boolean };
  items: { total: number; published: number; draft: number; inReview: number; suspended: number };
  byType: Record<string, number>;
  pendingReviews: number;
  installations: number;
  recent: Array<{ id: string; title: string; itemType: string; status: string; visibility: string; risk: string; installs: number; createdAt: string }>;
}> {
  const db = getDb();
  const [rows, pending, installs, recent] = await Promise.all([
    db.select({ status: libraryItems.status, itemType: libraryItems.itemType }).from(libraryItems),
    db.select({ n: sql<number>`count(*)::int` }).from(libraryReviews).where(eq(libraryReviews.status, 'PENDING')),
    db.select({ n: sql<number>`count(*)::int` }).from(libraryInstallations),
    db.select({ id: libraryItems.id, title: libraryItems.title, itemType: libraryItems.itemType, status: libraryItems.status, visibility: libraryItems.visibility, risk: libraryItems.riskLevel, installs: libraryItems.installationCount, createdAt: libraryItems.createdAt }).from(libraryItems).orderBy(desc(libraryItems.createdAt)).limit(20),
  ]);
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.itemType] = (byType[r.itemType] ?? 0) + 1;
  return {
    killSwitches: { library: libraryEnabled(), publicLibrary: publicLibraryEnabled(), creatorPublishing: publicCreatorPublishingEnabled(), paidMarketplace: paidMarketplaceEnabled() },
    items: {
      total: rows.length,
      published: rows.filter((r) => r.status === 'PUBLISHED').length,
      draft: rows.filter((r) => r.status === 'DRAFT').length,
      inReview: rows.filter((r) => r.status === 'SUBMITTED' || r.status === 'IN_REVIEW').length,
      suspended: rows.filter((r) => r.status === 'SUSPENDED').length,
    },
    byType,
    pendingReviews: pending[0]?.n ?? 0,
    installations: installs[0]?.n ?? 0,
    recent: recent.map((r) => ({ id: r.id, title: r.title, itemType: r.itemType, status: r.status, visibility: r.visibility, risk: r.risk, installs: r.installs ?? 0, createdAt: r.createdAt.toISOString() })),
  };
}
