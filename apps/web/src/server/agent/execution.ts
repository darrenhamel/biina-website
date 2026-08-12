import { getDb } from '@/server/db';
import { connectorUsageEvents } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { logSecurityEvent } from '@/server/auth/events';
import { resolveConnectionAccess } from '@/server/connectors/connections';
import { loadCredential } from '@/server/connectors/credentials';
import { executeTool } from '@/server/connectors/tool-execution';
import { getPlan } from '@/server/ai/plans';
import { getAgentTool } from './tool-catalog';
import { decidePolicy } from './policy';
import type { EffectivePolicy } from './policies-store';
import { consumeApproval } from './approvals';
import { getWriteAdapter } from './write-adapters';
import { idempotencyKey } from './hashing';
import { agentExecutionEnabled, agentWriteActionsEnabled, agentDryRunForced, toolKilled } from './risk';
import { updateAction, findExecutedAction, bumpSessionUsage } from './sessions';
import type { AgentAction } from '@/server/db/schema';

/**
 * AgentExecutionService — the SOLE path that runs an agent action. Reads delegate
 * to the connector ToolExecutionService (allowlisted); writes run here after a
 * gauntlet of LIVE checks that never trust the session's initial snapshot:
 *
 *   kill switches → dry-run → idempotency → live policy → consume approval →
 *   live connection status + scope → live org membership → live plan/quota →
 *   load server-only credential → adapter write → verify provider id → meter + audit
 *
 * A write with no VERIFIED provider id is reported as UNKNOWN_OUTCOME (never a
 * success), and is never auto-retried.
 */

export interface ExecInput {
  action: AgentAction;
  userId: string;
  organizationId: string | null;
  mode: 'CHAT' | 'ASSISTED' | 'AGENT';
  policy: EffectivePolicy;
  planSlug: string;
  /** Fresh, validated arguments the caller re-proposes at execution (hash-checked). */
  normalizedArgs: Record<string, unknown>;
  argumentsHash: string;
  requestId?: string | null;
  signal?: AbortSignal;
  dryRun: boolean;
}

export interface ExecResult {
  status: AgentAction['status'];
  externalResourceId?: string;
  summary: string;
  error?: string;
}

async function meter(entry: { connectorSlug: string; operation: string; connectionId: string | null; userId: string; organizationId: string | null; success: boolean; errorCode?: string; requestId?: string | null }) {
  try {
    await getDb().insert(connectorUsageEvents).values({
      connectorSlug: entry.connectorSlug,
      operation: entry.operation,
      connectionId: entry.connectionId,
      userId: entry.userId,
      organizationId: entry.organizationId,
      success: entry.success,
      errorCode: entry.errorCode,
      requestId: entry.requestId ?? null,
    });
  } catch (e) {
    logger.warn('agent.meter.failed', { error: String(e) });
  }
}

async function block(action: AgentAction, userId: string, orgId: string | null, reason: string): Promise<ExecResult> {
  await updateAction(action.id, { status: 'BLOCKED', error: reason.slice(0, 300), completedAt: new Date() });
  await logSecurityEvent({ event: 'agent.tool_denied', userId, actorUserId: userId, organizationId: orgId, metadata: { toolId: action.toolId, reason } });
  return { status: 'BLOCKED', summary: reason, error: reason };
}

/** Execute a single READ action through the connector ToolExecutionService. */
export async function executeReadAction(input: {
  action: AgentAction;
  userId: string;
  organizationId: string | null;
  operation: 'search' | 'read';
  args: Record<string, unknown>;
  requestId?: string | null;
}): Promise<ExecResult> {
  const tool = getAgentTool(input.action.toolId);
  if (!tool || tool.kind !== 'read') return block(input.action, input.userId, input.organizationId, 'Not a read tool.');
  await updateAction(input.action.id, { status: 'EXECUTING', executedAt: new Date() });
  try {
    const res = await executeTool({
      toolId: input.action.toolId,
      actorUserId: input.userId,
      activeOrganizationId: input.organizationId,
      connectionId: input.action.connectionId!,
      operation: input.operation,
      arguments: input.args,
      requestId: input.requestId ?? null,
    });
    if (!res.success) {
      await updateAction(input.action.id, { status: 'FAILED', error: res.error?.code ?? 'error', completedAt: new Date() });
      return { status: 'FAILED', summary: res.error?.message ?? 'Read failed', error: res.error?.code };
    }
    // Build a bounded, model-facing summary (never a giant raw provider payload).
    let summary: string;
    if (Array.isArray(res.data)) {
      const items = res.data as Array<{ externalId: string; name: string; snippet?: string; metadata?: { _text?: string } }>;
      summary = items.length
        ? `Found ${items.length} item(s): ` +
          items
            .slice(0, 5)
            .map((it, i) => `[#${i + 1} id=${it.externalId}] ${it.name}${it.snippet ? ` — ${it.snippet.slice(0, 160)}` : ''}`)
            .join('; ')
        : 'No matching items were found.';
    } else {
      const content = res.data as { text?: string; resource?: { name?: string } };
      summary = `Content of ${content.resource?.name ?? 'resource'}: ${(content.text ?? '').slice(0, 600)}`;
    }
    await updateAction(input.action.id, { status: 'SUCCEEDED', resultSummary: summary.slice(0, 500), completedAt: new Date() });
    return { status: 'SUCCEEDED', summary };
  } catch (err) {
    await updateAction(input.action.id, { status: 'FAILED', error: String(err).slice(0, 300), completedAt: new Date() });
    return { status: 'FAILED', summary: 'Read failed', error: String(err) };
  }
}

/** Execute a single WRITE action. Requires a valid, single-use, hash-bound approval. */
export async function executeWriteAction(input: ExecInput): Promise<ExecResult> {
  const { action, userId, organizationId } = input;
  const tool = getAgentTool(action.toolId);
  if (!tool || tool.kind !== 'write') return block(action, userId, organizationId, 'Unknown or non-write tool.');

  // 1. Kill switches (platform-level, non-negotiable).
  if (!agentExecutionEnabled()) return block(action, userId, organizationId, 'Agent execution is disabled platform-wide.');
  if (!agentWriteActionsEnabled()) return block(action, userId, organizationId, 'External writes are disabled platform-wide.');
  if (toolKilled(tool.id)) return block(action, userId, organizationId, 'Tool disabled by kill switch.');

  // 2. Dry-run: never touch an external system.
  if (input.dryRun || agentDryRunForced()) {
    await updateAction(action.id, { status: 'SUCCEEDED', resultSummary: 'DRY_RUN (not executed)', completedAt: new Date() });
    return { status: 'SUCCEEDED', summary: 'Dry run — action was previewed but not executed.' };
  }

  // 3. Idempotency: identical action already performed in this session → reuse it.
  const idem = action.idempotencyKey ?? idempotencyKey(action.agentSessionId, tool.id, input.argumentsHash);
  const prior = await findExecutedAction(action.agentSessionId, idem);
  if (prior && prior.id !== action.id && prior.status === 'SUCCEEDED') {
    await updateAction(action.id, { status: 'SUCCEEDED', externalResourceId: prior.externalResourceId, resultSummary: 'Deduplicated (already performed)', completedAt: new Date() });
    return { status: 'SUCCEEDED', externalResourceId: prior.externalResourceId ?? undefined, summary: 'Action already performed; not repeated.' };
  }

  // 4. Live policy re-decision (never trust the planning-time snapshot).
  const decision = decidePolicy({ tool, mode: input.mode, policy: input.policy });
  if (decision.decision === 'DENY') return block(action, userId, organizationId, `Policy denied: ${decision.reason}`);

  // 5. Consume the approval — atomic, single-use, hash-bound, owner-checked.
  const approval = await consumeApproval({ actionId: action.id, argumentsHash: input.argumentsHash, expectedUserId: userId, organizationId });
  if (!approval) return block(action, userId, organizationId, 'No valid approval (expired, reused, edited, or wrong user).');

  // 6. LIVE connection status + scope (a token may have been revoked since planning).
  const access = await resolveConnectionAccess(userId, action.connectionId!, organizationId);
  if (!access) return block(action, userId, organizationId, 'Connection not accessible (revoked or wrong tenant).');
  if (access.connection.status !== 'ACTIVE') return block(action, userId, organizationId, 'Connection needs to be reconnected.');
  if (access.connection.connectorSlug !== tool.connectorSlug) return block(action, userId, organizationId, 'Tool does not match this connection.');

  // 7. LIVE entitlement recheck (plan may have downgraded mid-session).
  const plan: Plan = await getPlan(input.planSlug);
  if (!plan.agentEnabled) return block(action, userId, organizationId, 'Your plan no longer includes the agent.');

  // 8. Load the server-only credential (never returned, logged, or shown to the model).
  const cred = await loadCredential(access.connection.id);
  if (!cred) return block(action, userId, organizationId, 'Connection needs to be reconnected.');

  const adapter = getWriteAdapter(tool.connectorSlug);
  if (!adapter) return block(action, userId, organizationId, 'This connector cannot perform writes.');

  await updateAction(action.id, { status: 'EXECUTING', idempotencyKey: idem, executedAt: new Date() });
  try {
    const result = await adapter.perform(cred, { operation: tool.operation, args: input.normalizedArgs, idempotencyKey: idem, signal: input.signal });

    if (result.outcome === 'SUCCEEDED') {
      // 9. VERIFY: success requires a provider resource id.
      if (!result.externalResourceId) {
        await updateAction(action.id, { status: 'UNKNOWN_OUTCOME', error: 'No provider id returned', completedAt: new Date() });
        await logSecurityEvent({ event: 'agent.action_unknown_outcome', userId, actorUserId: userId, organizationId, metadata: { toolId: tool.id } });
        return { status: 'UNKNOWN_OUTCOME', summary: 'Could not confirm the action completed.' };
      }
      await updateAction(action.id, { status: 'SUCCEEDED', externalResourceId: result.externalResourceId, resultSummary: (result.summary ?? 'done').slice(0, 500), completedAt: new Date() });
      await bumpSessionUsage(action.agentSessionId, { writeActions: 1 });
      await meter({ connectorSlug: tool.connectorSlug, operation: tool.operation, connectionId: access.connection.id, userId, organizationId: access.connection.organizationId, success: true, requestId: input.requestId });
      await logSecurityEvent({
        event: 'agent.action_executed',
        userId,
        actorUserId: userId,
        organizationId: access.connection.organizationId,
        metadata: { toolId: tool.id, connectionId: access.connection.id, risk: tool.risk, externalResourceId: result.externalResourceId, deduped: Boolean(result.deduped) },
      });
      return { status: 'SUCCEEDED', externalResourceId: result.externalResourceId, summary: result.summary ?? 'Completed.' };
    }

    if (result.outcome === 'UNKNOWN_OUTCOME') {
      // 10. Ambiguous write (e.g. timeout). Do NOT auto-retry; flag for verification.
      await updateAction(action.id, { status: 'UNKNOWN_OUTCOME', error: (result.error ?? 'unknown').slice(0, 300), completedAt: new Date() });
      await meter({ connectorSlug: tool.connectorSlug, operation: tool.operation, connectionId: access.connection.id, userId, organizationId: access.connection.organizationId, success: false, errorCode: 'UNKNOWN_OUTCOME', requestId: input.requestId });
      await logSecurityEvent({ event: 'agent.action_unknown_outcome', userId, actorUserId: userId, organizationId: access.connection.organizationId, metadata: { toolId: tool.id } });
      return { status: 'UNKNOWN_OUTCOME', summary: 'The provider did not confirm the outcome; manual verification is required.', error: result.error };
    }

    await updateAction(action.id, { status: 'FAILED', error: (result.error ?? 'failed').slice(0, 300), completedAt: new Date() });
    await meter({ connectorSlug: tool.connectorSlug, operation: tool.operation, connectionId: access.connection.id, userId, organizationId: access.connection.organizationId, success: false, errorCode: 'FAILED', requestId: input.requestId });
    await logSecurityEvent({ event: 'agent.action_failed', userId, actorUserId: userId, organizationId: access.connection.organizationId, metadata: { toolId: tool.id } });
    return { status: 'FAILED', summary: result.error ?? 'The action failed.', error: result.error };
  } catch (err) {
    // Network/exception: outcome is ambiguous. Never claim success, never auto-retry.
    await updateAction(action.id, { status: 'UNKNOWN_OUTCOME', error: String(err).slice(0, 300), completedAt: new Date() });
    await meter({ connectorSlug: tool.connectorSlug, operation: tool.operation, connectionId: access.connection.id, userId, organizationId: access.connection.organizationId, success: false, errorCode: 'EXCEPTION', requestId: input.requestId });
    await logSecurityEvent({ event: 'agent.action_unknown_outcome', userId, actorUserId: userId, organizationId: access.connection.organizationId, metadata: { toolId: tool.id } });
    return { status: 'UNKNOWN_OUTCOME', summary: 'The action could not be confirmed.', error: String(err) };
  }
}
