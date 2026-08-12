import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { billingCustomers, subscriptions, billingInvoices } from '@/server/db/schema';
import type { BillingCustomer, Subscription } from '@/server/db/schema';
import { writeAudit } from '@/server/ai/audit';
import { getPaymentProvider, BillingError } from './index';
import type { NormalizedSubscription, NormalizedInvoice } from './provider';
import { getCommercialPrice, getPriceByProviderId } from './catalog';
import { billingEnabled, appBaseUrl } from './config';
import { syncEntitlementForSubscription } from './entitlements';

/**
 * BillingService — the ONE thing the rest of BIINA calls for billing. It
 * orchestrates the payment provider + our records. Ownership is ALWAYS resolved
 * server-side from the authenticated scope; the browser never supplies a
 * customer/subscription/price provider id.
 */

export type BillingScope = { userId: string } | { organizationId: string };

function scopeWhere(scope: BillingScope) {
  return 'userId' in scope ? eq(billingCustomers.userId, scope.userId) : eq(billingCustomers.organizationId, scope.organizationId);
}

/** Find or create the billing customer for a scope (idempotent; no duplicates). */
export async function resolveBillingCustomer(
  scope: BillingScope,
  info: { email?: string | null; name?: string | null } = {},
): Promise<BillingCustomer> {
  const db = getDb();
  const [existing] = await db.select().from(billingCustomers).where(scopeWhere(scope)).limit(1);
  if (existing) return existing;

  if (!billingEnabled()) throw new BillingError(403, 'billing_disabled', 'Billing is not enabled');

  const metadata: Record<string, string> = 'userId' in scope ? { userId: scope.userId } : { organizationId: scope.organizationId };
  const providerCustomer = await getPaymentProvider().createCustomer({ email: info.email, name: info.name, metadata });

  const [row] = await db
    .insert(billingCustomers)
    .values({
      userId: 'userId' in scope ? scope.userId : null,
      organizationId: 'organizationId' in scope ? scope.organizationId : null,
      providerCustomerId: providerCustomer.id,
      email: info.email ?? null,
      billingName: info.name ?? null,
    })
    .onConflictDoNothing({ target: [billingCustomers.billingProvider, billingCustomers.providerCustomerId] })
    .returning();
  if (row) {
    await writeAudit({ action: 'billing.customer.created', targetType: 'billing_customer', targetId: row.id, newValue: { scope } });
    return row;
  }
  // Conflict → re-read.
  const [reread] = await db.select().from(billingCustomers).where(scopeWhere(scope)).limit(1);
  return reread!;
}

/**
 * Start a checkout for an approved commercial price. The server maps our
 * commercial price → the provider price id; the browser only names our UUID.
 */
export async function startCheckout(params: {
  scope: BillingScope;
  commercialPriceId: string;
  email?: string | null;
  name?: string | null;
  actorUserId: string;
  requirePaymentMethodForTrial?: boolean;
}): Promise<{ url: string }> {
  if (!billingEnabled()) throw new BillingError(403, 'billing_disabled', 'Billing is not enabled');

  const price = await getCommercialPrice(params.commercialPriceId);
  if (!price || !price.publiclyAvailable) throw new BillingError(400, 'invalid_price', 'Unknown or unavailable price');

  const customer = await resolveBillingCustomer(params.scope, { email: params.email, name: params.name });
  const base = appBaseUrl();
  const metadata: Record<string, string> = {
    commercialPriceId: price.id,
    planSlug: price.planSlug,
    ...('userId' in params.scope ? { userId: params.scope.userId } : { organizationId: params.scope.organizationId }),
  };

  const session = await getPaymentProvider().createCheckoutSession({
    customerId: customer.providerCustomerId,
    providerPriceId: price.providerPriceId,
    successUrl: `${base}/en/app/settings/billing?checkout=success`,
    cancelUrl: `${base}/en/pricing?checkout=cancelled`,
    trialDays: price.trialDays,
    requirePaymentMethodForTrial: params.requirePaymentMethodForTrial ?? true,
    metadata,
    // Idempotent per (customer, price) to blunt double-submits.
    idempotencyKey: `checkout:${customer.providerCustomerId}:${price.id}`,
  });

  await writeAudit({
    adminUserId: params.actorUserId,
    action: 'billing.checkout.initiated',
    targetType: 'billing_customer',
    targetId: customer.id,
    newValue: { planSlug: price.planSlug, commercialPriceId: price.id },
  });
  return { url: session.url };
}

/** Open the provider billing portal for a scope. */
export async function openBillingPortal(scope: BillingScope): Promise<{ url: string }> {
  if (!billingEnabled()) throw new BillingError(403, 'billing_disabled', 'Billing is not enabled');
  const [customer] = await getDb().select().from(billingCustomers).where(scopeWhere(scope)).limit(1);
  if (!customer) throw new BillingError(404, 'no_customer', 'No billing customer for this account');
  const session = await getPaymentProvider().createBillingPortalSession({
    customerId: customer.providerCustomerId,
    returnUrl: `${appBaseUrl()}/en/app/settings/billing`,
  });
  return { url: session.url };
}

/** Resolve a subscription BY OUR id and verify it belongs to the scope. */
async function ownedSubscription(scope: BillingScope, subscriptionId: string): Promise<Subscription> {
  const [sub] = await getDb().select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!sub) throw new BillingError(404, 'no_subscription', 'Subscription not found');
  const owned = 'userId' in scope ? sub.userId === scope.userId : sub.organizationId === scope.organizationId;
  if (!owned) throw new BillingError(404, 'no_subscription', 'Subscription not found'); // no existence leak
  return sub;
}

export async function cancelSubscription(scope: BillingScope, subscriptionId: string, actorUserId: string, atPeriodEnd = true) {
  const sub = await ownedSubscription(scope, subscriptionId);
  const normalized = await getPaymentProvider().cancelSubscription(sub.providerSubscriptionId, atPeriodEnd);
  await writeAudit({ adminUserId: actorUserId, action: 'billing.subscription.cancel_requested', targetType: 'subscription', targetId: sub.id, newValue: { atPeriodEnd } });
  return upsertSubscriptionFromProvider(normalized);
}

export async function resumeSubscription(scope: BillingScope, subscriptionId: string, actorUserId: string) {
  const sub = await ownedSubscription(scope, subscriptionId);
  const normalized = await getPaymentProvider().resumeSubscription(sub.providerSubscriptionId);
  await writeAudit({ adminUserId: actorUserId, action: 'billing.subscription.resumed', targetType: 'subscription', targetId: sub.id });
  return upsertSubscriptionFromProvider(normalized);
}

export async function changeSubscription(
  scope: BillingScope,
  subscriptionId: string,
  newCommercialPriceId: string,
  actorUserId: string,
) {
  const sub = await ownedSubscription(scope, subscriptionId);
  const price = await getCommercialPrice(newCommercialPriceId);
  if (!price) throw new BillingError(400, 'invalid_price', 'Unknown price');
  const normalized = await getPaymentProvider().changeSubscription({
    providerSubscriptionId: sub.providerSubscriptionId,
    newProviderPriceId: price.providerPriceId,
  });
  await writeAudit({ adminUserId: actorUserId, action: 'billing.subscription.changed', targetType: 'subscription', targetId: sub.id, newValue: { to: price.planSlug } });
  return upsertSubscriptionFromProvider(normalized);
}

/**
 * Upsert a subscription from AUTHORITATIVE provider state and re-sync
 * entitlements. Resolves the owner from an existing record, the billing customer,
 * or the checkout metadata — never from the browser. Idempotent.
 */
export async function upsertSubscriptionFromProvider(n: NormalizedSubscription): Promise<Subscription> {
  const db = getDb();

  // Map provider price → our commercial price → plan (source of truth = our catalog).
  const price = n.providerPriceId ? await getPriceByProviderId('stripe', n.providerPriceId) : null;

  // Resolve owner: existing sub → billing customer → event metadata.
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, n.providerSubscriptionId)).limit(1);
  let userId: string | null = existing?.userId ?? null;
  let organizationId: string | null = existing?.organizationId ?? null;

  if (!userId && !organizationId && n.providerCustomerId) {
    const [cust] = await db
      .select()
      .from(billingCustomers)
      .where(and(eq(billingCustomers.billingProvider, 'stripe'), eq(billingCustomers.providerCustomerId, n.providerCustomerId)))
      .limit(1);
    if (cust) {
      userId = cust.userId;
      organizationId = cust.organizationId;
    }
  }
  if (!userId && !organizationId && n.metadata) {
    userId = n.metadata.userId ?? null;
    organizationId = n.metadata.organizationId ?? null;
  }

  const planSlug = price?.planSlug ?? existing?.planSlug ?? 'FREE';
  const values = {
    userId,
    organizationId,
    planSlug,
    commercialPriceId: price?.id ?? existing?.commercialPriceId ?? null,
    providerCustomerId: n.providerCustomerId,
    providerSubscriptionId: n.providerSubscriptionId,
    status: n.status,
    currentPeriodStart: n.currentPeriodStart,
    currentPeriodEnd: n.currentPeriodEnd,
    cancelAtPeriodEnd: n.cancelAtPeriodEnd,
    canceledAt: n.canceledAt,
    trialStart: n.trialStart,
    trialEnd: n.trialEnd,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(subscriptions)
    .values(values as never)
    .onConflictDoUpdate({ target: subscriptions.providerSubscriptionId, set: values as never })
    .returning();

  // Entitlements follow verified state.
  if (row.userId || row.organizationId) await syncEntitlementForSubscription(row);
  return row;
}

/** Upsert an invoice reference from provider state (no card data). */
export async function upsertInvoice(n: NormalizedInvoice): Promise<void> {
  const db = getDb();
  let subscriptionId: string | null = null;
  let billingCustomerId: string | null = null;
  if (n.providerSubscriptionId) {
    const [sub] = await db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.providerSubscriptionId, n.providerSubscriptionId)).limit(1);
    subscriptionId = sub?.id ?? null;
  }
  if (n.providerCustomerId) {
    const [cust] = await db
      .select({ id: billingCustomers.id })
      .from(billingCustomers)
      .where(and(eq(billingCustomers.billingProvider, 'stripe'), eq(billingCustomers.providerCustomerId, n.providerCustomerId)))
      .limit(1);
    billingCustomerId = cust?.id ?? null;
  }
  const values = {
    subscriptionId,
    billingCustomerId,
    providerInvoiceId: n.providerInvoiceId,
    status: n.status,
    currency: n.currency,
    subtotal: n.subtotal,
    tax: n.tax,
    total: n.total,
    periodStart: n.periodStart,
    periodEnd: n.periodEnd,
    invoiceUrl: n.invoiceUrl,
    invoicePdfUrl: n.invoicePdfUrl,
  };
  await db
    .insert(billingInvoices)
    .values(values as never)
    .onConflictDoUpdate({ target: billingInvoices.providerInvoiceId, set: values as never });
}

/** Billing summary for the settings page (safe fields only). */
export async function getBillingSummary(scope: BillingScope) {
  const db = getDb();
  const [customer] = await db.select().from(billingCustomers).where(scopeWhere(scope)).limit(1);
  const subWhere = 'userId' in scope ? eq(subscriptions.userId, scope.userId) : eq(subscriptions.organizationId, scope.organizationId);
  const subs = await db.select().from(subscriptions).where(subWhere).orderBy(desc(subscriptions.createdAt));
  const active = subs.find((s) => ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(s.status)) ?? subs[0] ?? null;

  let invoices: Array<{ id: string; status: string | null; total: number | null; currency: string | null; createdAt: Date; invoiceUrl: string | null }> = [];
  if (customer) {
    invoices = (
      await db
        .select({ id: billingInvoices.id, status: billingInvoices.status, total: billingInvoices.total, currency: billingInvoices.currency, createdAt: billingInvoices.createdAt, invoiceUrl: billingInvoices.invoiceUrl })
        .from(billingInvoices)
        .where(eq(billingInvoices.billingCustomerId, customer.id))
        .orderBy(desc(billingInvoices.createdAt))
        .limit(12)
    );
  }

  return {
    hasBillingAccount: Boolean(customer),
    subscription: active
      ? {
          id: active.id,
          planSlug: active.planSlug,
          status: active.status,
          currentPeriodEnd: active.currentPeriodEnd,
          cancelAtPeriodEnd: active.cancelAtPeriodEnd,
          trialEnd: active.trialEnd,
        }
      : null,
    invoices,
  };
}
