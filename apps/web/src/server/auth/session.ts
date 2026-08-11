import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { eq, and, gt } from 'drizzle-orm';
import { getDb } from '../db';
import { sessions, users, profiles } from '../db/schema';
import { SESSION_COOKIE } from './constants';

/**
 * Server-side session handling.
 *
 * The raw session token lives ONLY in an http-only cookie. The database stores
 * its SHA-256 hash as the row id, so a database leak does not hand out live
 * sessions. All validation is authoritative on the server.
 */

export { SESSION_COOKIE };
const SESSION_TTL_DAYS = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  };
}

/** Create a session for a user and set the cookie. Returns nothing sensitive. */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await getDb().insert(sessions).values({ id, userId, expiresAt });
  cookies().set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function destroyCurrentSession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    const id = hashToken(token);
    await getDb().delete(sessions).where(eq(sessions.id, id));
  }
  cookies().delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  plan: 'FREE' | 'PRO' | 'BUSINESS' | 'ENTERPRISE' | 'ADMIN';
  createdAt: Date;
  displayName: string;
  locale: string;
  personaId: string | null;
}

/** Resolve the authenticated user from the session cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hashToken(token);

  const rows = await getDb()
    .select({
      userId: users.id,
      email: users.email,
      role: users.role,
      plan: users.plan,
      createdAt: users.createdAt,
      displayName: profiles.displayName,
      locale: profiles.locale,
      personaId: profiles.personaId,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.userId,
    email: row.email,
    role: row.role,
    plan: row.plan,
    createdAt: row.createdAt,
    displayName: row.displayName ?? row.email.split('@')[0],
    locale: row.locale ?? 'en',
    personaId: row.personaId ?? null,
  };
}
