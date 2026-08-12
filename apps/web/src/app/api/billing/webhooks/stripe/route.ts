import { NextRequest, NextResponse } from 'next/server';
import { processStripeWebhook } from '@/server/billing/webhooks';
import { logger } from '@/lib/logger';

/**
 * POST /api/billing/webhooks/stripe — provider webhook sink.
 *
 * Reads the RAW body (required for signature verification — no JSON parsing or
 * body-modifying middleware in the path). No auth/CSRF: authenticity comes from
 * the signature, not a session (Stripe posts server-to-server with no Origin).
 * Returns 400 on bad signature, 500 on handler failure (so the provider retries),
 * 200 once the event is recorded/processed (including idempotent duplicates).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const raw = await req.text(); // exact bytes — do not parse before verifying
  const signature = req.headers.get('stripe-signature');
  try {
    const result = await processStripeWebhook(raw, signature);
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as { name?: string; status?: number }).name === 'BillingError' ? (err as { status: number }).status : 500;
    if (status >= 500) {
      logger.error('billing.webhook.route_error', { error: String(err) });
      return NextResponse.json({ error: 'webhook processing failed' }, { status: 500 });
    }
    // Bad signature / malformed — do not retry.
    return NextResponse.json({ error: 'invalid webhook' }, { status });
  }
}
