import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { eq, and, gt, ne } from 'drizzle-orm';
import { getDb } from '../db';
import { sessions, users, profiles } from '../db/schema';
import { SESSION_COOKIE } from './constants';
import type { PlatformRole } from './permissions';

/**
 * Server-side session handling.
 *
 * The raw session token lives ONLY in an http-only cookie. The database stores
 * its SHA-256 hash as the row id, so a database leak does not hand out live
 * sessions. All validation is authoritative on the server, and a non-ACTIVE
 * account resolves to "not authenticated" everywhere (suspension/disable is
 * enforced server-side, not just in the UI).
 */

export { SESSION_COOKIE };
const SESSION_TTL_DAYS = 30;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

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

export function currentSessionId(): string | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

/** Create a session for a user (with optional non-invasive metadata) and set the cookie. */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await getDb().insert(sessions).values({
    id,
    userId,
    expiresAt,
    lastUsedAt: new Date(),
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
    ip: meta.ip?.slice(0, 64) ?? null,
  });
  cookies().set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function destroyCurrentSession(): Promise<void> {
  const id = currentSessionId();
  if (id) await getDb().delete(sessions).where(eq(sessions.id, id));
  cookies().delete(SESSION_COOKIE);
}

/** Revoke a specific session (only if it belongs to the user). */
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/** Revoke every session for a user EXCEPT the current one (sign out other devices). */
export async function revokeOtherSessions(userId: string): Promise<void> {
  const id = currentSessionId();
  const db = getDb();
  if (id) await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, id)));
  else await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Revoke ALL sessions for a user (used after a password change/reset). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

export async function listSessions(userId: string) {
  const current = currentSessionId();
  const rows = await getDb()
    .select({ id: sessions.id, createdAt: sessions.createdAt, lastUsedAt: sessions.lastUsedAt, userAgent: sessions.userAgent })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  return rows.map((s) => ({ ...s, current: s.id === current }));
}

export interface SessionUser {
  id: string;
  email: string;
  role: PlatformRole;
  plan: 'FREE' | 'PRO' | 'BUSINESS' | 'ENTERPRISE' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  emailVerified: boolean;
  createdAt: Date;
  displayName: string;
  locale: string;
  personaId: string | null;
}

/** Resolve the authenticated, ACTIVE user from the session cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const id = currentSessionId();
  if (!id) return null;

  const db = getDb();
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      role: users.role,
      plan: users.plan,
      status: users.status,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      displayName: profiles.displayName,
      locale: profiles.locale,
      personaId: profiles.personaId,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // Suspended/disabled accounts cannot use authenticated resources.
  if (row.status !== 'ACTIVE') return null;

  // Throttled lastUsedAt refresh (best-effort).
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, id)).catch(() => {});
  }

  return {
    id: row.userId,
    email: row.email,
    role: row.role,
    plan: row.plan,
    status: row.status,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt,
    displayName: row.displayName ?? row.email.split('@')[0],
    locale: row.locale ?? 'en',
    personaId: row.personaId ?? null,
  };
}

/** Best-effort client metadata for session/security records (privacy-conscious). */
export function requestMeta(headers: Headers): { userAgent: string | null; ip: string | null } {
  const userAgent = headers.get('user-agent');
  const fwd = headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0]!.trim() : headers.get('x-real-ip');
  return { userAgent, ip };
}
