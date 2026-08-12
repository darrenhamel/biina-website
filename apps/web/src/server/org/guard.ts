import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from '@/server/auth/session';
import { isOrgManager, canChangeMemberRoles, type OrgRole } from '@/server/auth/permissions';
import { resolveOrgContext, type OrgContext } from './organizations';

/**
 * Organization authorization guards. Every org route goes through these so
 * membership + role are ALWAYS verified server-side (IDOR-safe). A non-member
 * gets 404 (not 403) so org existence isn't leaked.
 */

type Guarded = { user: SessionUser; ctx: OrgContext } | { response: NextResponse };

async function base(slug: string): Promise<Guarded> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  const ctx = await resolveOrgContext(user.id, slug);
  if (!ctx) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  return { user, ctx };
}

export async function requireOrgMember(slug: string): Promise<Guarded> {
  return base(slug);
}

export async function requireOrgManager(slug: string): Promise<Guarded> {
  const g = await base(slug);
  if ('response' in g) return g;
  if (!isOrgManager(g.ctx.role as OrgRole)) {
    return { response: NextResponse.json({ error: 'Insufficient organization role' }, { status: 403 }) };
  }
  return g;
}

export async function requireOrgOwner(slug: string): Promise<Guarded> {
  const g = await base(slug);
  if ('response' in g) return g;
  if (!canChangeMemberRoles(g.ctx.role as OrgRole)) {
    return { response: NextResponse.json({ error: 'Owner access required' }, { status: 403 }) };
  }
  return g;
}
