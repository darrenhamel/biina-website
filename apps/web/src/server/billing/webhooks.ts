import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { billingWebhookEvents } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { writeAudit } from '@/server/ai/audit';
import { getPaymentProvider } from './index';
import { upsertSubscriptionFromProvider, upsertInvoice } from './service';

/**
 * Webhook processing — signature-verified, IDEMPOTENT, safe-retryable.
 *
 * Provider webhook state is authoritative: we never trust a checkout redirect.
 * Each event is recorded (unique on provider event id). An already-PROCESSED
 * event is skipped; a previously-FAILED or in-flight one may be reprocessed
 * because every downstream write (subscription upsert, invoice upsert,
 * entitlement sync) is idempotent. On handler failure we record the failure and
 * signal the caller to return non-2xx so the provider retries.
 */

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'customer.subscription.trial_will_end',
]);

export interface WebhookResult {
  ok: boolean;
  duplicate?: boolean;
  eventType?: string;
  handled?: boolean;
}

/**
 * Verify + process a raw webhook body. Throws on signature failure (→ 400) or
 * handler failure (→ 500 so the provider retries). `rawBody` MUST be the exact
 * bytes received (no middleware re-encoding), for signature verification.
 */
export async function processStripeWebhook(rawBody: string, signature: string | null): Promise<WebhookResult> {
  const provider = getPaymentProvider();
  const event = provider.verifyWebhook(rawBody, signature); // throws BillingError(400) on bad signature
  const db = getDb();

  // Idempotency: insert first; a duplicate delivery loses the race and is skipped.
  const [inserted] = await db
    .insert(billingWebhookEvents)
    .values({ providerEventId: event.id, eventType: event.type, status: 'received' })
    .onConflictDoNothing({ target: billingWebhookEvents.providerEventId })
    .returning({ id: billingWebhookEvents.id });

  let rowId = inserted?.id;
  if (!rowId) {
    const [existing] = await db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.providerEventId, event.id)).limit(1);
    if (existing?.status === 'processed') return { ok: true, duplicate: true, eventType: event.type };
    rowId = existing?.id; // received/failed → allow reprocessing (downstream is idempotent)
  }

  if (!HANDLED.has(event.type)) {
    if (rowId) await db.update(billingWebhookEvents).set({ status: 'processed', processedAt: new Date() }).where(eq(billingWebhookEvents.id, rowId));
    return { ok: true, eventType: event.type, handled: false };
  }

  try {
    // Re-fetch the authoritative subscription this event references, then sync.
    const subId = provider.webhookSubscriptionId(event);
    if (subId) {
      const normalized = await provider.retrieveSubscription(subId);
      await upsertSubscriptionFromProvider(normalized);
    }
    // Persist invoice references (paid / failed) — no card data.
    const invoice = provider.parseInvoiceFromEvent(event);
    if (invoice) await upsertInvoice(invoice);

    if (rowId) await db.update(billingWebhookEvents).set({ status: 'processed', processedAt: new Date() }).where(eq(billingWebhookEvents.id, rowId));
    await writeAudit({ action: `billing.webhook.${event.type}`, targetType: 'billing_webhook', targetId: event.id });
    return { ok: true, eventType: event.type, handled: true };
  } catch (err) {
    logger.error('billing.webhook.failed', { eventId: event.id, eventType: event.type, error: String(err) });
    if (rowId) await db.update(billingWebhookEvents).set({ status: 'failed', error: String(err) }).where(eq(billingWebhookEvents.id, rowId));
    throw err; // route returns 500 → provider retries later
  }
}
