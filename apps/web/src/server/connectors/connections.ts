import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { connections } from '@/server/db/schema';
import type { Connection } from '@/server/db/schema';
import { resolveOrgContextById } from '@/server/org/organizations';
import { isOrgManager } from '@/server/auth/permissions';
import { logSecurityEvent } from '@/server/auth/events';
import { notFound, forbidden } from '@/lib/errors';
import { deleteCredential } from './credentials';

/**
 * Connection ownership + ISOLATION (critical). Personal and organization
 * connections are distinct security domains:
 *  - a PERSONAL connection is usable only by its owner (never shared with an org);
 *  - an ORGANIZATION connection is usable only within THAT org's active workspace
 *    by a verified member (Org A can never reach Org B's connection).
 * `resolveConnectionAccess` verifies this server-side and returns null otherwise.
 */

export interface ConnectionAccess {
  connection: Connection;
  canManage: boolean; // owner (personal) or org manager (organization)
}

export async function resolveConnectionAccess(
  userId: string,
  connectionId: string,
  activeOrganizationId: string | null,
): Promise<ConnectionAccess | null> {
  const [conn] = await getDb().select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) return null;

  if (conn.connectionType === 'PERSONAL') {
    if (conn.userId !== userId) return null; // never another user's personal connection
    return { connection: conn, canManage: true };
  }
  // ORGANIZATION: must match the ACTIVE workspace org AND the caller must be a member.
  if (!conn.organizationId || conn.organizationId !== activeOrganizationId) return null;
  const ctx = await resolveOrgContextById(userId, conn.organizationId);
  if (!ctx) return null;
  return { connection: conn, canManage: isOrgManager(ctx.role) };
}

/** Connections available in a scope (personal for a user, or one org's). */
export async function listConnectionsForScope(scope: { userId: string } | { organizationId: string }): Promise<Connection[]> {
  const where =
    'organizationId' in scope
      ? and(eq(connections.organizationId, scope.organizationId), eq(connections.connectionType, 'ORGANIZATION'))
      : and(eq(connections.userId, scope.userId), eq(connections.connectionType, 'PERSONAL'), isNull(connections.organizationId));
  return getDb().select().from(connections).where(where).orderBy(desc(connections.createdAt));
}

export async function touchConnectionUsed(connectionId: string): Promise<void> {
  await getDb().update(connections).set({ lastUsedAt: new Date() }).where(eq(connections.id, connectionId));
}

export async function setConnectionStatus(connectionId: string, status: Connection['status'], error?: string | null): Promise<void> {
  await getDb().update(connections).set({ status, error: error ?? null, updatedAt: new Date() }).where(eq(connections.id, connectionId));
}

/** Disconnect: revoke + securely delete the credential, mark REVOKED. Keeps audit. */
export async function revokeConnection(userId: string, connectionId: string, activeOrganizationId: string | null) {
  const access = await resolveConnectionAccess(userId, connectionId, activeOrganizationId);
  if (!access) throw notFound('Not found');
  if (!access.canManage) throw forbidden('You cannot manage this connection.');

  // Best-effort provider revocation would go here (per-provider); always clear locally.
  await deleteCredential(connectionId);
  await setConnectionStatus(connectionId, 'REVOKED');
  await logSecurityEvent({
    event: 'connector.revoked',
    userId,
    actorUserId: userId,
    organizationId: access.connection.organizationId,
    metadata: { connectionId, connector: access.connection.connectorSlug },
  });
  return { ok: true };
}
