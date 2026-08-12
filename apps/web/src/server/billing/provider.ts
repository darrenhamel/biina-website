/**
 * Provider-independent payment interface.
 *
 * The rest of BIINA talks to `BillingService`, which talks to a `PaymentProvider`.
 * Only the adapter (e.g. Stripe) knows vendor specifics. Swapping providers means
 * a new adapter — no change to the service, routes, entitlements, or UI.
 *
 * All amounts are in the currency's MINOR unit (fils/cents). No card data ever
 * crosses this interface.
 */

export type ProviderName = 'stripe';

/** Normalized subscription state (vendor states mapped into ours). */
export type NormalizedStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE'
  | 'UNPAID'
  | 'PAUSED';

export interface ProviderCustomer {
  id: string;
  email?: string | null;
}

export interface CreateCustomerParams {
  email?: string | null;
  name?: string | null;
  /** Correlate the provider customer back to our records. */
  metadata?: Record<string, string>;
}

export interface CheckoutParams {
  customerId: string;
  /** Provider price id — resolved server-side from an approved commercial price. */
  providerPriceId: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number | null;
  /** Whether a trial requires a card up front (config decision). */
  requirePaymentMethodForTrial?: boolean;
  metadata?: Record<string, string>;
  /** Idempotency key so a double-submit can't create two checkouts. */
  idempotencyKey?: string;
}

export interface PortalParams {
  customerId: string;
  returnUrl: string;
}

export interface ChangeSubscriptionParams {
  providerSubscriptionId: string;
  newProviderPriceId: string;
  /** Let the provider handle proration; explicit + configurable. */
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}

export interface NormalizedSubscription {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  providerPriceId: string | null;
  status: NormalizedStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  metadata?: Record<string, string>;
}

export interface NormalizedInvoice {
  providerInvoiceId: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  status: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  invoiceUrl: string | null;
  invoicePdfUrl: string | null;
}

export interface WebhookEvent {
  id: string;
  type: string;
  /** The event's primary object, already vendor-shaped; adapter parses it. */
  raw: unknown;
}

export interface HostedSession {
  id: string;
  url: string;
}

/**
 * The operations a payment provider must support. Kept to useful billing
 * operations — not over-generalized.
 */
export interface PaymentProvider {
  readonly name: ProviderName;

  createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer>;
  createCheckoutSession(params: CheckoutParams): Promise<HostedSession>;
  createBillingPortalSession(params: PortalParams): Promise<HostedSession>;
  cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<NormalizedSubscription>;
  resumeSubscription(providerSubscriptionId: string): Promise<NormalizedSubscription>;
  changeSubscription(params: ChangeSubscriptionParams): Promise<NormalizedSubscription>;
  retrieveSubscription(providerSubscriptionId: string): Promise<NormalizedSubscription>;
  retrieveInvoice(providerInvoiceId: string): Promise<NormalizedInvoice>;

  /**
   * Verify a webhook signature against the raw body and return the parsed event.
   * Throws if the signature is invalid. MUST receive the ORIGINAL raw bytes.
   */
  verifyWebhook(rawBody: string, signature: string | null): WebhookEvent;

  /**
   * The subscription id an event references (a subscription object, a completed
   * checkout session, or an invoice), or null. The service RE-FETCHES that
   * subscription so provider state — not the event payload — is authoritative.
   */
  webhookSubscriptionId(event: WebhookEvent): string | null;

  /** Extract a normalized invoice from a webhook event object, if present. */
  parseInvoiceFromEvent(event: WebhookEvent): NormalizedInvoice | null;
}

/** Raised for billing-layer failures; carries a safe HTTP status. */
export class BillingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
    this.code = code;
  }
}
