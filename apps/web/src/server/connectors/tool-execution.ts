import { logSecurityEvent } from '@/server/auth/events';
import { badRequest, forbidden, notFound } from '@/lib/errors';
import { getTool, writeToolsEnabled } from './registry';
import { resolveConnectionAccess } from './connections';
import { searchConnection, readConnection } from './service';

/**
 * ToolExecutionService — the single gateway for connector operations (agents will
 * use it later). ONLY allowlisted tools run: there is no "call arbitrary URL" or
 * "execute arbitrary API" tool, which structurally blocks SSRF, arbitrary side
 * effects, and data exfiltration. Identity is derived SERVER-SIDE, never from the
 * browser. WRITE tools are registered but DISABLED by default → ACTION_NOT_ENABLED.
 */

export interface ToolRequest {
  toolId: string;
  actorUserId: string; // server-derived; never trusted from the client
  activeOrganizationId: string | null;
  connectionId: string;
  operation?: 'search' | 'read';
  arguments: Record<string, unknown>;
  requestId?: string | null;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
  provenance?: { connector: string; connectionId: string };
  requestId?: string | null;
}

export async function executeTool(req: ToolRequest): Promise<ToolResult> {
  const tool = getTool(req.toolId);
  if (!tool) throw badRequest('Unknown tool'); // allowlist — nothing else may run

  // WRITE / side-effecting tools: registered but not executed in Phase 10.
  if (tool.risk !== 'READ') {
    const enabled = writeToolsEnabled() && tool.enabledByDefault;
    if (!enabled) {
      await logSecurityEvent({ event: 'connector.action_blocked', userId: req.actorUserId, actorUserId: req.actorUserId, organizationId: req.activeOrganizationId, metadata: { toolId: req.toolId, risk: tool.risk } });
      return { success: false, error: { code: 'ACTION_NOT_ENABLED', message: 'This action is not enabled.' }, requestId: req.requestId };
    }
  }

  const access = await resolveConnectionAccess(req.actorUserId, req.connectionId, req.activeOrganizationId);
  if (!access) throw notFound('Not found'); // isolation: not owner / wrong tenant → no leak
  if (access.connection.connectorSlug !== tool.connectorSlug) throw forbidden('Tool does not match this connection.');

  await logSecurityEvent({ event: 'connector.action_attempted', userId: req.actorUserId, actorUserId: req.actorUserId, organizationId: access.connection.organizationId, metadata: { toolId: req.toolId, connectionId: req.connectionId } });

  const provenance = { connector: access.connection.connectorSlug, connectionId: access.connection.id };
  if (tool.operation === 'search') {
    const query = String(req.arguments.query ?? '').slice(0, 400);
    if (!query) throw badRequest('A query is required.');
    const data = await searchConnection(access, req.actorUserId, query, Number(req.arguments.max ?? 5), req.requestId ?? null);
    return { success: true, data, provenance, requestId: req.requestId };
  }
  if (tool.operation === 'read') {
    const externalId = String(req.arguments.externalId ?? '');
    if (!externalId) throw badRequest('A resource id is required.');
    const data = await readConnection(access, req.actorUserId, externalId, req.requestId ?? null);
    return { success: true, data, provenance, requestId: req.requestId };
  }
  // Any other (write) operation never reaches here in Phase 10.
  return { success: false, error: { code: 'ACTION_NOT_ENABLED', message: 'This action is not enabled.' }, requestId: req.requestId };
}
