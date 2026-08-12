import { getDb } from '@/server/db';
import { connectorUsageEvents } from '@/server/db/schema';
import type { Connection } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { logSecurityEvent } from '@/server/auth/events';
import { badRequest, forbidden } from '@/lib/errors';
import { getAdapter, type NormalizedResource, type ExternalContent } from './adapters';
import { loadCredential } from './credentials';
import { touchConnectionUsed, setConnectionStatus, type ConnectionAccess } from './connections';
import { isReadCapability, type Capability } from './registry';

/**
 * ConnectorService — the ONLY path to a provider. It resolves the connection,
 * validates capability + scope + status, loads the (decrypted, server-only)
 * credential, calls the adapter, normalizes the result, meters + audits, and
 * redacts sensitive errors. The AI layer NEVER bypasses this. Credentials never
 * leave this boundary; they are never returned, logged, or put in a prompt.
 */

export type ConnectorErrorCode = 'AUTH_EXPIRED' | 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'RESOURCE_NOT_FOUND' | 'PROVIDER_UNAVAILABLE' | 'INVALID_SCOPE' | 'REAUTH_REQUIRED';

export class ConnectorError extends Error {
  constructor(readonly code: ConnectorErrorCode, message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
}

function normalizeProviderError(err: unknown): ConnectorError {
  const msg = String((err as Error)?.message ?? err);
  if (/401|unauthor/i.test(msg)) return new ConnectorError('REAUTH_REQUIRED', 'Reconnect required');
  if (/403|permission|forbidden/i.test(msg)) return new ConnectorError('PERMISSION_DENIED', 'Permission denied by the provider');
  if (/429|rate/i.test(msg)) return new ConnectorError('RATE_LIMITED', 'The provider is rate-limiting requests');
  if (/404|not found/i.test(msg)) return new ConnectorError('RESOURCE_NOT_FOUND', 'Resource not found');
  return new ConnectorError('PROVIDER_UNAVAILABLE', 'The connected service is temporarily unavailable');
}

async function meter(entry: { connectorSlug: string; operation: string; connection: Connection; userId: string; success: boolean; errorCode?: string; latencyMs: number; requestId?: string | null; resourceType?: string }) {
  try {
    await getDb().insert(connectorUsageEvents).values({
      connectorSlug: entry.connectorSlug,
      operation: entry.operation,
      connectionId: entry.connection.id,
      userId: entry.userId,
      organizationId: entry.connection.organizationId,
      resourceType: entry.resourceType,
      success: entry.success,
      errorCode: entry.errorCode,
      latencyMs: entry.latencyMs,
      requestId: entry.requestId ?? null,
    });
  } catch (e) {
    logger.warn('connector.meter.failed', { error: String(e) });
  }
}

/** Core: validate + run one adapter operation. Never leaks the credential. */
async function run<T>(
  access: ConnectionAccess,
  operation: 'search' | 'read',
  capability: Capability,
  userId: string,
  requestId: string | null,
  fn: (adapter: NonNullable<ReturnType<typeof getAdapter>>, cred: NonNullable<Awaited<ReturnType<typeof loadCredential>>>) => Promise<T>,
): Promise<T> {
  const { connection } = access;
  if (connection.status !== 'ACTIVE') throw new ConnectorError('REAUTH_REQUIRED', 'This connection needs to be reconnected.');
  if (!isReadCapability(capability)) throw forbidden('Only read operations are permitted here.');
  if (!(connection.capabilities ?? []).includes(capability)) throw badRequest('This connection does not grant that capability.');

  const adapter = getAdapter(connection.connectorSlug);
  if (!adapter || typeof (adapter as unknown as Record<string, unknown>)[operation] !== 'function') {
    throw new ConnectorError('PROVIDER_UNAVAILABLE', 'Operation not supported by this connector.');
  }
  const cred = await loadCredential(connection.id);
  if (!cred) throw new ConnectorError('REAUTH_REQUIRED', 'This connection needs to be reconnected.');

  const started = Date.now();
  try {
    const result = await fn(adapter, cred);
    await touchConnectionUsed(connection.id);
    await meter({ connectorSlug: connection.connectorSlug, operation, connection, userId, success: true, latencyMs: Date.now() - started, requestId });
    await logSecurityEvent({ event: operation === 'search' ? 'connector.search' : 'connector.read', userId, actorUserId: userId, organizationId: connection.organizationId, metadata: { connector: connection.connectorSlug, connectionId: connection.id } });
    return result;
  } catch (err) {
    const ce = err instanceof ConnectorError ? err : normalizeProviderError(err);
    if (ce.code === 'REAUTH_REQUIRED' || ce.code === 'AUTH_EXPIRED') await setConnectionStatus(connection.id, 'REAUTH_REQUIRED');
    await meter({ connectorSlug: connection.connectorSlug, operation, connection, userId, success: false, errorCode: ce.code, latencyMs: Date.now() - started, requestId });
    throw ce;
  }
}

export async function searchConnection(access: ConnectionAccess, userId: string, query: string, max: number, requestId: string | null, signal?: AbortSignal): Promise<NormalizedResource[]> {
  return run(access, 'search', 'SEARCH', userId, requestId, (adapter, cred) => adapter.search!(cred, { query, max, signal }));
}

export async function readConnection(access: ConnectionAccess, userId: string, externalId: string, requestId: string | null, signal?: AbortSignal): Promise<ExternalContent> {
  return run(access, 'read', 'READ', userId, requestId, (adapter, cred) => adapter.read!(cred, externalId, signal));
}
