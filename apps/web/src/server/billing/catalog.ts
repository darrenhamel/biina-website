import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { commercialPrices } from '@/server/db/schema';
import type { CommercialPrice } from '@/server/db/schema';

/**
 * Commercial-price catalog. The SERVER maps an approved commercial price → a
 * provider price id. The browser NEVER supplies a provider price id; it can only
 * reference a commercial price by our own UUID, which we validate here.
 */

/** Publicly listable prices (enabled + publiclyAvailable), for the pricing page. */
export async function listPublicPrices(): Promise<CommercialPrice[]> {
  return getDb()
    .select()
    .from(commercialPrices)
    .where(and(eq(commercialPrices.enabled, true), eq(commercialPrices.publiclyAvailable, true)))
    .orderBy(asc(commercialPrices.amount));
}

/** All prices (admin view). */
export async function listAllPrices(): Promise<CommercialPrice[]> {
  return getDb().select().from(commercialPrices).orderBy(asc(commercialPrices.planSlug), asc(commercialPrices.amount));
}

/** Resolve a commercial price by our UUID — returns null if missing or disabled. */
export async function getCommercialPrice(id: string): Promise<CommercialPrice | null> {
  const [row] = await getDb().select().from(commercialPrices).where(eq(commercialPrices.id, id)).limit(1);
  if (!row || !row.enabled) return null;
  return row;
}

/** Find the local commercial price for a provider price id (webhook → plan mapping). */
export async function getPriceByProviderId(billingProvider: 'stripe', providerPriceId: string): Promise<CommercialPrice | null> {
  const [row] = await getDb()
    .select()
    .from(commercialPrices)
    .where(and(eq(commercialPrices.billingProvider, billingProvider), eq(commercialPrices.providerPriceId, providerPriceId)))
    .limit(1);
  return row ?? null;
}

// ---- Admin commercial-price management (audited) ----

export async function createCommercialPrice(input: Record<string, unknown>, adminUserId: string) {
  const { writeAudit } = await import('@/server/ai/audit');
  const [row] = await getDb().insert(commercialPrices).values(input as never).returning();
  await writeAudit({ adminUserId, action: 'billing.price.create', targetType: 'commercial_price', targetId: row.id, newValue: { planSlug: row.planSlug, currency: row.currency, amount: row.amount } });
  return row;
}

export async function updateCommercialPrice(id: string, patch: Record<string, unknown>, adminUserId: string) {
  const db = getDb();
  const [prev] = await db.select().from(commercialPrices).where(eq(commercialPrices.id, id)).limit(1);
  if (!prev) return null;
  const set = { ...patch, updatedAt: new Date() };
  await db.update(commercialPrices).set(set as never).where(eq(commercialPrices.id, id));
  const { writeAudit } = await import('@/server/ai/audit');
  await writeAudit({ adminUserId, action: 'billing.price.update', targetType: 'commercial_price', targetId: id, newValue: patch });
  return { ok: true };
}
