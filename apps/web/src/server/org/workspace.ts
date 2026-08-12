import type { NextRequest } from 'next/server';
import { resolveOrgContext } from './organizations';
import { WORKSPACE_COOKIE } from './constants';

/**
 * Resolve the caller's ACTIVE workspace from the (hint-only) cookie, VERIFYING
 * org membership server-side. Returns the trusted org id or null (personal). A
 * suspended org is treated as unavailable. Never trusts a browser-supplied id.
 */
export async function activeWorkspace(
  req: NextRequest,
  userId: string,
): Promise<{ organizationId: string | null; suspended: boolean; role: string | null }> {
  const slug = req.cookies.get(WORKSPACE_COOKIE)?.value;
  if (!slug || slug === 'personal') return { organizationId: null, suspended: false, role: null };
  const ctx = await resolveOrgContext(userId, slug);
  if (!ctx) return { organizationId: null, suspended: false, role: null }; // not a member → personal
  if (ctx.org.status !== 'ACTIVE') return { organizationId: null, suspended: true, role: null };
  return { organizationId: ctx.org.id, suspended: false, role: ctx.role };
}
