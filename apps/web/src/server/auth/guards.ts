import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from './session';
import { isPlatformAdmin, canChangePlatformRoles } from './permissions';

/**
 * Server-side authorization guards. Authorization is ALWAYS enforced here —
 * never by hiding UI. Return either the user or a NextResponse to send back.
 */

export async function requireUser(): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  return { user };
}

export async function requireAdmin(): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  if (!isPlatformAdmin(user.role)) {
    return { response: NextResponse.json({ error: 'Administrator access required' }, { status: 403 }) };
  }
  return { user };
}

export async function requireSuperAdmin(): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  if (!canChangePlatformRoles(user.role)) {
    return { response: NextResponse.json({ error: 'Super administrator access required' }, { status: 403 }) };
  }
  return { user };
}
