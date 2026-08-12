import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { requestMeta } from '@/server/auth/session';
import { createOrganization, listUserOrgs } from '@/server/org/organizations';
import { createOrgSchema } from '@/lib/validation';
import { handleError } from '@/lib/api';

/** GET (list my orgs) + POST (create an org). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ organizations: await listUserOrgs(auth.user.id) });
  } catch (err) {
    return handleError(err, 'orgs.list');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const input = createOrgSchema.parse(await req.json());
    const meta = requestMeta(req.headers);
    const org = await createOrganization(auth.user, input, meta);
    return NextResponse.json({ ok: true, organization: { slug: org.slug, displayName: org.displayName } }, { status: 201 });
  } catch (err) {
    return handleError(err, 'orgs.create');
  }
}
