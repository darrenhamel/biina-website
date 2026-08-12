import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { loadBillingConfig, updateBillingConfig } from '@/server/billing/config';
import { billingConfigSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** GET / PATCH the non-secret billing + tax config (ADMIN). Secrets stay in env. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ config: await loadBillingConfig() });
  } catch (err) {
    return handleError(err, 'admin.billing.config.get');
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const patch = billingConfigSchema.parse(await req.json());
    return NextResponse.json(await updateBillingConfig(patch, auth.user.id));
  } catch (err) {
    return handleError(err, 'admin.billing.config.update');
  }
}
