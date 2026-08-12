import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { updateCommercialPrice } from '@/server/billing/catalog';
import { updateCommercialPriceSchema } from '@/lib/validation';
import { handleError, notFound } from '@/lib/api';

/** PATCH /api/admin/billing/prices/[id] — edit a commercial price (ADMIN). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const idSchema = z.string().uuid();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const id = idSchema.parse(params.id);
    const patch = updateCommercialPriceSchema.parse(await req.json());
    const res = await updateCommercialPrice(id, patch, auth.user.id);
    if (!res) return notFound('Price not found');
    return NextResponse.json(res);
  } catch (err) {
    return handleError(err, 'admin.billing.prices.update');
  }
}
