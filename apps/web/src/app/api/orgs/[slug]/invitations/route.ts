import { NextRequest, NextResponse } from 'next/server';
import { requireOrgManager } from '@/server/org/guard';
import { createInvitation, listInvitations } from '@/server/org/invitations';
import { getEmailService, emailTemplates, devLinksEnabled } from '@/server/email';
import { inviteSchema } from '@/lib/validation';
import { rateLimit, RL } from '@/server/lib/rate-limit';
import { appBaseUrl } from '@/lib/url';
import { handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const g = await requireOrgManager(params.slug);
  if ('response' in g) return g.response;
  try {
    return NextResponse.json({ invitations: await listInvitations(g.ctx.org.id) });
  } catch (err) {
    return handleError(err, 'orgs.invitations.list');
  }
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const g = await requireOrgManager(params.slug);
  if ('response' in g) return g.response;
  try {
    const rl = rateLimit(`invite:${g.ctx.org.id}`, RL.invite.max, RL.invite.windowMs);
    if (!rl.allowed) return NextResponse.json({ error: 'Too many invitations right now. Try again shortly.' }, { status: 429 });

    const input = inviteSchema.parse(await req.json());
    const { token, email } = await createInvitation(g.ctx.org, g.user, input);
    const url = `${appBaseUrl(req)}/en/invite?token=${token}`;
    await getEmailService().send({ ...emailTemplates.orgInvite(g.ctx.org.displayName, url), to: email });
    return NextResponse.json({ ok: true, ...(devLinksEnabled() ? { devInviteLink: url } : {}) }, { status: 201 });
  } catch (err) {
    return handleError(err, 'orgs.invitations.create');
  }
}
