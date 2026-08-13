import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { serviceAccounts } from '@/server/db/schema';
import type { ServiceAccount } from '@/server/db/schema';
import { AppError } from '@/lib/errors';
import { logSecurityEvent } from '@/server/auth/events';
import { sanitizePermissions } from './rbac';

/**
 * Machine-to-machine service accounts (readiness). Scoped, expiring, audited, no
 * interactive login. Tokens are HASHED (shown once). A service account is NOT a human
 * user and never carries a session. Not broadly enabled in Phase 17 — created DISABLED
 * unless explicitly activated.
 */

function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

export async function createServiceAccount(organizationId: string, input: { name: string; scopes: string[]; expiresAt?: Date | null }, actorUserId: string): Promise<{ account: ServiceAccount; token: string }> {
  const token = `svc_${randomBytes(30).toString('base64url')}`;
  const [account] = await getDb()
    .insert(serviceAccounts)
    .values({ organizationId, name: input.name, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 8), scopes: sanitizePermissions(input.scopes), status: 'DISABLED', expiresAt: input.expiresAt ?? null, createdByUserId: actorUserId })
    .returning();
  await logSecurityEvent({ event: 'enterprise.service_account_created', actorUserId, organizationId, metadata: { name: input.name, scopes: account.scopes } });
  return { account, token };
}

export async function listServiceAccounts(organizationId: string): Promise<Array<Omit<ServiceAccount, 'tokenHash'>>> {
  const rows = await getDb().select().from(serviceAccounts).where(eq(serviceAccounts.organizationId, organizationId));
  return rows.map(({ tokenHash: _omit, ...rest }) => rest);
}

/** Authenticate a service-account token (only ACTIVE + unexpired). Returns org + scopes. */
export async function authenticateServiceAccount(token: string | null | undefined): Promise<{ organizationId: string; scopes: string[] }> {
  if (!token) throw new AppError(401, 'Service token required.', 'svc_no_token');
  const [acc] = await getDb().select().from(serviceAccounts).where(eq(serviceAccounts.tokenHash, hashToken(token))).limit(1);
  if (!acc || acc.status !== 'ACTIVE') throw new AppError(401, 'Invalid or disabled service account.', 'svc_invalid');
  if (acc.expiresAt && acc.expiresAt.getTime() < new Date().getTime()) throw new AppError(401, 'Service account expired.', 'svc_expired');
  await getDb().update(serviceAccounts).set({ lastUsedAt: new Date() }).where(eq(serviceAccounts.id, acc.id));
  return { organizationId: acc.organizationId, scopes: (acc.scopes as string[]) ?? [] };
}

export async function setServiceAccountStatus(organizationId: string, id: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
  await getDb().update(serviceAccounts).set({ status }).where(and(eq(serviceAccounts.id, id), eq(serviceAccounts.organizationId, organizationId)));
}
