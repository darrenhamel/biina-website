import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  PaymentProvider,
  ProviderCustomer,
  CreateCustomerParams,
  CheckoutParams,
  PortalParams,
  ChangeSubscriptionParams,
  NormalizedSubscription,
  NormalizedInvoice,
  NormalizedStatus,
  WebhookEvent,
  HostedSession,
} from '../provider';
import { BillingError } from '../provider';

/**
 * Stripe adapter — implemented directly against the Stripe REST API with `fetch`
 * + `node:crypto` (no SDK dependency), mirroring how the OpenAI-compatible AI
 * provider is built. All calls are server-side; the secret key and webhook
 * secret never leave the server. Webhook signatures are verified with Stripe's
 * documented HMAC-SHA256 scheme.
 */

const STRIPE_API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SEC = 5 * 60;

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new BillingError(500, 'not_configured', 'Stripe secret key is not configured');
  return key;
}

/** Flatten nested params into Stripe's bracket form-encoding. */
export function encodeForm(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const nested = encodeForm(v as Record<string, unknown>, key);
      if (nested) parts.push(nested);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') parts.push(encodeForm(item as Record<string, unknown>, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join('&');
}

async function stripeRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let url = `${STRIPE_API}${path}`;
  let body: string | undefined;
  const encoded = params ? encodeForm(params) : '';
  if (method === 'GET') {
    if (encoded) url += `?${encoded}`;
  } else {
    body = encoded;
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe request failed (${res.status})`;
    // 4xx from Stripe is a client/config problem; 5xx is upstream.
    throw new BillingError(res.status >= 500 ? 502 : 400, 'provider_error', msg);
  }
  return json as T;
}

// ---- Stripe object shapes (only the fields we read) ----
interface StripeSub {
  id: string;
  customer: string | null;
  status: string;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  trial_start?: number | null;
  trial_end?: number | null;
  items?: { data?: Array<{ price?: { id?: string }; current_period_start?: number; current_period_end?: number }> };
  metadata?: Record<string, string>;
}
interface StripeInvoice {
  id: string;
  subscription?: string | null;
  customer?: string | null;
  status?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  lines?: { data?: Array<{ period?: { start?: number; end?: number } }> };
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
}

const STATUS_MAP: Record<string, NormalizedStatus> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELED',
  unpaid: 'UNPAID',
  paused: 'PAUSED',
};

const ts = (n?: number | null): Date | null => (typeof n === 'number' ? new Date(n * 1000) : null);

export function normalizeSubscription(s: StripeSub): NormalizedSubscription {
  const item = s.items?.data?.[0];
  return {
    providerSubscriptionId: s.id,
    providerCustomerId: s.customer ?? null,
    providerPriceId: item?.price?.id ?? null,
    status: STATUS_MAP[s.status] ?? 'INCOMPLETE',
    currentPeriodStart: ts(s.current_period_start ?? item?.current_period_start),
    currentPeriodEnd: ts(s.current_period_end ?? item?.current_period_end),
    cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
    canceledAt: ts(s.canceled_at),
    trialStart: ts(s.trial_start),
    trialEnd: ts(s.trial_end),
    metadata: s.metadata ?? {},
  };
}

function normalizeInvoice(inv: StripeInvoice): NormalizedInvoice {
  const period = inv.lines?.data?.[0]?.period;
  return {
    providerInvoiceId: inv.id,
    providerSubscriptionId: inv.subscription ?? null,
    providerCustomerId: inv.customer ?? null,
    status: inv.status ?? null,
    currency: inv.currency ?? null,
    subtotal: inv.subtotal ?? null,
    tax: inv.tax ?? null,
    total: inv.total ?? null,
    periodStart: ts(period?.start),
    periodEnd: ts(period?.end),
    invoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdfUrl: inv.invoice_pdf ?? null,
  };
}

/** Verify Stripe's `Stripe-Signature` header against the raw body. Pure/testable. */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): void {
  if (!signatureHeader) throw new BillingError(400, 'invalid_signature', 'Missing signature');
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, ...rest] = p.split('=');
      return [k.trim(), rest.join('=')];
    }),
  );
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) throw new BillingError(400, 'invalid_signature', 'Malformed signature');
  if (Math.abs(nowSec - Number(t)) > WEBHOOK_TOLERANCE_SEC) {
    throw new BillingError(400, 'invalid_signature', 'Signature timestamp outside tolerance');
  }
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new BillingError(400, 'invalid_signature', 'Signature verification failed');
  }
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  async createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer> {
    const c = await stripeRequest<{ id: string; email?: string | null }>('POST', '/customers', {
      email: params.email ?? undefined,
      name: params.name ?? undefined,
      metadata: params.metadata,
    });
    return { id: c.id, email: c.email ?? null };
  }

  async createCheckoutSession(params: CheckoutParams): Promise<HostedSession> {
    const body: Record<string, unknown> = {
      mode: 'subscription',
      customer: params.customerId,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      line_items: [{ price: params.providerPriceId, quantity: 1 }],
      metadata: params.metadata,
      subscription_data: params.metadata ? { metadata: params.metadata } : undefined,
    };
    if (params.trialDays && params.trialDays > 0) {
      body.subscription_data = {
        ...(body.subscription_data as Record<string, unknown> | undefined),
        trial_period_days: params.trialDays,
      };
      // If a trial does not require a card, tell Stripe not to collect one.
      if (!params.requirePaymentMethodForTrial) body.payment_method_collection = 'if_required';
    }
    const s = await stripeRequest<{ id: string; url: string }>('POST', '/checkout/sessions', body, params.idempotencyKey);
    return { id: s.id, url: s.url };
  }

  async createBillingPortalSession(params: PortalParams): Promise<HostedSession> {
    const s = await stripeRequest<{ id: string; url: string }>('POST', '/billing_portal/sessions', {
      customer: params.customerId,
      return_url: params.returnUrl,
    });
    return { id: s.id, url: s.url };
  }

  async cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<NormalizedSubscription> {
    // Cancel-at-period-end keeps access until the paid period ends (customer-friendly).
    const s = atPeriodEnd
      ? await stripeRequest<StripeSub>('POST', `/subscriptions/${providerSubscriptionId}`, { cancel_at_period_end: true })
      : await stripeRequest<StripeSub>('DELETE', `/subscriptions/${providerSubscriptionId}`);
    return normalizeSubscription(s);
  }

  async resumeSubscription(providerSubscriptionId: string): Promise<NormalizedSubscription> {
    const s = await stripeRequest<StripeSub>('POST', `/subscriptions/${providerSubscriptionId}`, {
      cancel_at_period_end: false,
    });
    return normalizeSubscription(s);
  }

  async changeSubscription(params: ChangeSubscriptionParams): Promise<NormalizedSubscription> {
    const current = await stripeRequest<StripeSub>('GET', `/subscriptions/${params.providerSubscriptionId}`);
    const itemId = (current as StripeSub & { items?: { data?: Array<{ id?: string }> } }).items?.data?.[0]?.id;
    const s = await stripeRequest<StripeSub>('POST', `/subscriptions/${params.providerSubscriptionId}`, {
      items: [{ id: itemId, price: params.newProviderPriceId }],
      proration_behavior: params.prorationBehavior ?? 'create_prorations',
    });
    return normalizeSubscription(s);
  }

  async retrieveSubscription(providerSubscriptionId: string): Promise<NormalizedSubscription> {
    const s = await stripeRequest<StripeSub>('GET', `/subscriptions/${providerSubscriptionId}`);
    return normalizeSubscription(s);
  }

  async retrieveInvoice(providerInvoiceId: string): Promise<NormalizedInvoice> {
    const inv = await stripeRequest<StripeInvoice>('GET', `/invoices/${providerInvoiceId}`);
    return normalizeInvoice(inv);
  }

  verifyWebhook(rawBody: string, signature: string | null): WebhookEvent {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new BillingError(500, 'not_configured', 'Stripe webhook secret is not configured');
    verifyStripeSignature(rawBody, signature, secret);
    const evt = JSON.parse(rawBody) as { id: string; type: string; data?: { object?: unknown } };
    return { id: evt.id, type: evt.type, raw: evt.data?.object ?? null };
  }

  webhookSubscriptionId(event: WebhookEvent): string | null {
    const obj = event.raw as Record<string, unknown> | null;
    if (!obj) return null;
    // Subscription object → its own id.
    if (event.type.startsWith('customer.subscription.')) return (obj.id as string) ?? null;
    // Checkout session → its subscription reference.
    if (event.type === 'checkout.session.completed') return (obj.subscription as string) ?? null;
    // Invoice → its subscription reference.
    if (event.type.startsWith('invoice.')) return (obj.subscription as string) ?? null;
    return null;
  }

  parseInvoiceFromEvent(event: WebhookEvent): NormalizedInvoice | null {
    if (!event.type.startsWith('invoice.')) return null;
    const obj = event.raw as StripeInvoice | null;
    if (!obj || !obj.id) return null;
    return normalizeInvoice(obj);
  }
}
