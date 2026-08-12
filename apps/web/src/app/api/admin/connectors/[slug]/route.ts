import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { setConnectorEnabled } from '@/server/connectors/admin';
import { handleError } from '@/lib/api';

/** PATCH /api/admin/connectors/[slug] — enable/disable a connector (ADMIN). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ enabled: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const { enabled } = bodySchema.parse(await req.json());
    return NextResponse.json(await setConnectorEnabled(params.slug, enabled));
  } catch (err) {
    return handleError(err, 'admin.connectors.toggle');
  }
}
