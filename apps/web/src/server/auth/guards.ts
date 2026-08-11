import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from './session';

/**
 * Server-side admin gate. Returns the admin user, or a NextResponse (401/403) to
 * return immediately. Authorization is ALWAYS enforced here — never by hiding UI.
 */
export async function requireAdmin(): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  }
  if (user.role !== 'ADMIN') {
    return { response: NextResponse.json({ error: 'Administrator access required' }, { status: 403 }) };
  }
  return { user };
}
