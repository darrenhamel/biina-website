import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { activeWorkspace } from '@/server/org/workspace';
import { beginOAuth } from '@/server/connectors/oauth';
import { getPlan } from '@/server/ai/plans';
import { handleError, forbidden } from '@/lib/api';

/** POST /api/connectors/[slug]/connect — begin an OAuth connect. Returns the auth URL. */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({ connectionType: z.enum(['PERSONAL', 'ORGANIZATION']).default('PERSONAL') });

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const plan = await getPlan(auth.user.plan);
    if (!plan.connectorsEnabled) return forbidden('Your plan does not include connectors.');
    const { connectionType } = bodySchema.parse(await req.json().catch(() => ({})));
    const ws = await activeWorkspace(req, auth.user.id);
    const { authorizationUrl } = await beginOAuth({
      userId: auth.user.id,
      connectorSlug: params.slug,
      connectionType,
      organizationId: connectionType === 'ORGANIZATION' ? ws.organizationId : null,
    });
    return NextResponse.json({ authorizationUrl });
  } catch (err) {
    return handleError(err, 'connectors.connect');
  }
}
