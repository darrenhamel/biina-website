import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { listAllPrices, createCommercialPrice } from '@/server/billing/catalog';
import { upsertCommercialPriceSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** GET (list) / POST (create) commercial prices — ADMIN. Secrets never exposed. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ prices: await listAllPrices() });
  } catch (err) {
    return handleError(err, 'admin.billing.prices.list');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const input = upsertCommercialPriceSchema.parse(await req.json());
    const row = await createCommercialPrice(input, auth.user.id);
    return NextResponse.json({ ok: true, price: row }, { status: 201 });
  } catch (err) {
    return handleError(err, 'admin.billing.prices.create');
  }
}
