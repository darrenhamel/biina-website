import { startAssistantReply, collectStream } from '@/server/ai/service';
import type { RouteContext } from '@/server/ai/routing';
import { logger } from '@/lib/logger';
import { logSecurityEvent } from '@/server/auth/events';
import type { AgentSession, Plan } from '@/server/db/schema';
import { listConnectionsForScope } from '@/server/connectors/connections';
import { buildToolCatalog, getAgentTool, type CatalogEntry } from './tool-catalog';
import { resolveEffectivePolicy, type EffectivePolicy } from './policies-store';
import { decidePolicy } from './policy';
import { normalizeArguments, hashArguments, idempotencyKey } from './hashing';
import { buildActionPreview, type ActionPreview } from './preview';
import { createApproval } from './approvals';
import { executeReadAction, executeWriteAction } from './execution';
import { renderAgentState } from './agent-prompt';
import {
  addStep,
  createAction,
  setSessionPlan,
  setSessionStatus,
  bumpSessionUsage,
  listSteps,
  getSession,
  getAction,
} from './sessions';
import type { AgentAction, ApprovalRequest } from '@/server/db/schema';

/**
 * AgentOrchestrator — the bounded, human-supervised control loop. The model
 * PROPOSES (plan / tool / final); BIINA VALIDATES, AUTHORIZES, EXECUTES, LIMITS,
 * and AUDITS. Reads with an ALLOW policy run immediately; every write pauses the
 * run for human approval (AWAITING_APPROVAL) and only resumes on a valid approval.
 * Steps, tool calls, runtime, cost, and repetition are all bounded.
 */

export type AgentDecision =
  | { type: 'plan'; steps: string[] }
  | { type: 'tool'; toolId: string; arguments: Record<string, unknown>; note?: string }
  | { type: 'final'; message: string };

export interface AgentRunResult {
  status: AgentSession['status'];
  message?: string;
  approval?: { id: string; expiresAt: string; preview: ActionPreview };
  actionId?: string;
}

export interface RunContext {
  session: AgentSession;
  userId: string;
  organizationId: string | null;
  planSlug: string;
  plan: Plan;
  routeContext: RouteContext;
  signal?: AbortSignal;
}

// ---- Model turn (injectable for deterministic tests / offline demo) ----

export interface ModelTurn {
  text: string;
  requestId: string;
  cost: number;
}
export type ModelTurnFn = (input: { state: string; routeContext: RouteContext; conversationId: string | null; signal?: AbortSignal }) => Promise<ModelTurn>;

const defaultModelTurn: ModelTurnFn = async ({ state, routeContext, conversationId, signal }) => {
  const { requestId, stream } = startAssistantReply({
    messages: [{ role: 'user', content: state }],
    routeContext,
    signal,
    conversationId: conversationId ?? undefined,
  });
  const text = await collectStream(stream);
  const cost = Number(process.env.AGENT_ESTIMATED_TURN_COST ?? 0) || 0;
  return { text, requestId, cost };
};

let modelTurn: ModelTurnFn = defaultModelTurn;
/** Test/demo hook — inject a deterministic "model". Pass null to restore the LLM. */
export function __setModelTurn(fn: ModelTurnFn | null): void {
  modelTurn = fn ?? defaultModelTurn;
}

// ---- Limits ----

function hardStepLimit(): number {
  const n = Number(process.env.AGENT_MAX_STEPS_HARD_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 20;
}
const LOOP_THRESHOLD = 2;

/** Extract the first JSON object from model text and validate its shape. */
export function parseDecision(text: string): AgentDecision | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.type === 'plan' && Array.isArray(o.steps)) return { type: 'plan', steps: o.steps.map(String).slice(0, 12) };
  if (o.type === 'final' && typeof o.message === 'string') return { type: 'final', message: o.message };
  if (o.type === 'tool' && typeof o.toolId === 'string') return { type: 'tool', toolId: o.toolId, arguments: (o.arguments as Record<string, unknown>) ?? {}, note: typeof o.note === 'string' ? o.note : undefined };
  return null;
}

interface HistoryEntry {
  role: 'tool' | 'note';
  toolId?: string;
  text: string;
}

/** Rebuild the model-facing history from persisted operational steps. */
async function loadHistory(sessionId: string): Promise<HistoryEntry[]> {
  const steps = await listSteps(sessionId);
  const out: HistoryEntry[] = [];
  for (const s of steps) {
    if (s.stepType === 'TOOL_READ' && s.outputSummary) out.push({ role: 'tool', toolId: s.toolId ?? undefined, text: s.outputSummary });
    else if ((s.stepType === 'BLOCKED' || s.stepType === 'NOTE') && s.outputSummary) out.push({ role: 'note', text: s.outputSummary });
  }
  return out;
}

async function buildCatalog(rc: RunContext, policy: EffectivePolicy): Promise<CatalogEntry[]> {
  const conns = await listConnectionsForScope(rc.organizationId ? { organizationId: rc.organizationId } : { userId: rc.userId });
  const deniedToolIds = new Set<string>();
  return buildToolCatalog({
    mode: rc.session.mode,
    plan: rc.plan,
    connections: conns.map((c) => ({ id: c.id, connectorSlug: c.connectorSlug, status: c.status, capabilities: (c.capabilities ?? []) as string[] })),
    deniedToolIds,
    writesAllowedByMode: rc.session.mode !== 'CHAT',
  });
}

function budgetExceeded(session: AgentSession): boolean {
  return session.costBudget != null && session.estimatedCost >= session.costBudget;
}

/** Run the bounded loop until a final answer, an approval pause, or a limit. */
export async function advanceAgentSession(rc: RunContext): Promise<AgentRunResult> {
  const policy = await resolveEffectivePolicy({ userId: rc.userId, organizationId: rc.organizationId });
  if (!policy.agentEnabled) {
    await setSessionStatus(rc.session.id, 'BLOCKED', { error: 'Agent disabled by policy' });
    return { status: 'BLOCKED', message: 'The agent is disabled by policy.' };
  }
  const catalog = await buildCatalog(rc, policy);
  const history = await loadHistory(rc.session.id);
  const seen = new Map<string, number>();
  const maxSteps = Math.min(rc.session.maxSteps, policy.maxStepsPerSession ?? hardStepLimit(), hardStepLimit());

  let session = rc.session;
  await setSessionStatus(session.id, 'RUNNING', { startedAt: session.startedAt ?? new Date() });
  let step = session.stepsUsed;
  let malformed = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    session = (await getSession(session.id))!;
    if (session.status === 'CANCELED') return { status: 'CANCELED', message: 'Canceled.' };
    if (step >= maxSteps) return finalize(session.id, 'COMPLETED', 'Reached the step limit for this run.');
    if (session.deadlineAt && Date.now() > session.deadlineAt.getTime()) return finalize(session.id, 'BLOCKED', 'The run exceeded its time limit.');
    if (budgetExceeded(session)) return finalize(session.id, 'BLOCKED', 'The run reached its cost budget.');

    const needPlan = (session.plan?.length ?? 0) === 0 && step === 0;
    const state = renderAgentState({ goal: session.goal, catalog, history: history.slice(-12), needPlan });

    let turn: ModelTurn;
    try {
      turn = await modelTurn({ state, routeContext: rc.routeContext, conversationId: session.conversationId, signal: rc.signal });
    } catch (err) {
      logger.warn('agent.model_turn_failed', { sessionId: session.id, error: String(err) });
      return finalize(session.id, 'FAILED', 'The model was unavailable for this run.');
    }
    if (turn.cost) await bumpSessionUsage(session.id, { cost: turn.cost });

    const decision = parseDecision(turn.text);
    if (!decision) {
      malformed += 1;
      if (malformed > 2) return finalize(session.id, 'FAILED', 'The model returned malformed output.');
      history.push({ role: 'note', text: 'Your previous response was not valid JSON. Reply with exactly one JSON object.' });
      step += 1;
      await bumpSessionUsage(session.id, { steps: 1 });
      continue;
    }
    malformed = 0;

    if (decision.type === 'plan') {
      await setSessionPlan(session.id, decision.steps);
      await addStep({ agentSessionId: session.id, stepIndex: step, stepType: 'PLAN', status: 'SUCCEEDED', outputSummary: decision.steps.join(' | ') });
      step += 1;
      await bumpSessionUsage(session.id, { steps: 1 });
      continue;
    }

    if (decision.type === 'final') {
      await addStep({ agentSessionId: session.id, stepIndex: step, stepType: 'RESPOND', status: 'SUCCEEDED', outputSummary: decision.message.slice(0, 1000) });
      return finalize(session.id, 'COMPLETED', decision.message);
    }

    // decision.type === 'tool'
    const tool = getAgentTool(decision.toolId);
    if (!tool) {
      history.push({ role: 'note', text: `Tool "${decision.toolId}" is not available. Choose one of the listed tools.` });
      await addStep({ agentSessionId: session.id, stepIndex: step, stepType: 'BLOCKED', toolId: decision.toolId, status: 'SKIPPED', outputSummary: `Unknown tool ${decision.toolId}` });
      step += 1;
      await bumpSessionUsage(session.id, { steps: 1 });
      continue;
    }

    let normalized: Record<string, unknown>;
    let hash: string;
    try {
      normalized = normalizeArguments(tool, decision.arguments);
      hash = hashArguments(tool.id, normalized);
    } catch {
      history.push({ role: 'note', text: `Arguments for ${tool.id} were invalid; check the required fields.` });
      await addStep({ agentSessionId: session.id, stepIndex: step, stepType: 'BLOCKED', toolId: tool.id, status: 'SKIPPED', outputSummary: 'Invalid arguments' });
      step += 1;
      await bumpSessionUsage(session.id, { steps: 1 });
      continue;
    }

    // Loop detection — repeated identical tool call.
    const key = `${tool.id}:${hash}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > LOOP_THRESHOLD) return finalize(session.id, 'BLOCKED', 'Stopped: the agent repeated the same action.');

    const entry = catalog.find((e) => e.toolId === tool.id);
    if (!entry) {
      history.push({ role: 'note', text: `No active connection is available for ${tool.id}.` });
      await addStep({ agentSessionId: session.id, stepIndex: step, stepType: 'BLOCKED', toolId: tool.id, status: 'SKIPPED', outputSummary: 'No connection available' });
      step += 1;
      await bumpSessionUsage(session.id, { steps: 1 });
      continue;
    }

    await logSecurityEvent({ event: 'agent.tool_proposed', userId: rc.userId, actorUserId: rc.userId, organizationId: rc.organizationId, metadata: { sessionId: session.id, toolId: tool.id, risk: tool.risk } });
    const pol = decidePolicy({ tool, mode: session.mode, policy });

    if (pol.decision === 'DENY') {
      await logSecurityEvent({ event: 'agent.tool_denied', userId: rc.userId, actorUserId: rc.userId, organizationId: rc.organizationId, metadata: { sessionId: session.id, toolId: tool.id, reason: pol.reason } });
      history.push({ role: 'note', text: `Action ${tool.id} is not permitted (${pol.reason}). Do not attempt it again.` });
      await addStep({ agentSessionId: session.id, stepIndex: step, stepType: 'BLOCKED', toolId: tool.id, status: 'SKIPPED', outputSummary: `Denied: ${pol.reason}` });
      step += 1;
      await bumpSessionUsage(session.id, { steps: 1, toolCalls: 1 });
      continue;
    }

    // READ + ALLOW → execute immediately.
    if (tool.kind === 'read' && pol.decision === 'ALLOW') {
      const idem = idempotencyKey(session.id, tool.id, hash);
      const action = await createAction({ agentSessionId: session.id, toolId: tool.id, connectionId: entry.connectionId, riskLevel: tool.risk, reversibility: tool.reversibility, approvalStatus: 'NOT_REQUIRED', normalizedArguments: normalized, argumentsHash: hash, status: 'PROPOSED', idempotencyKey: idem });
      await logSecurityEvent({ event: 'agent.tool_allowed', userId: rc.userId, actorUserId: rc.userId, organizationId: rc.organizationId, metadata: { sessionId: session.id, toolId: tool.id } });
      const operation = tool.operation === 'read' ? 'read' : 'search';
      const res = await executeReadAction({ action, userId: rc.userId, organizationId: rc.organizationId, operation, args: normalized, requestId: turn.requestId });
      await addStep({ agentSessionId: session.id, stepIndex: step, stepType: 'TOOL_READ', toolId: tool.id, actionId: action.id, status: res.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED', inputSummary: decision.note ?? tool.description, outputSummary: res.summary, requestId: turn.requestId });
      history.push({ role: 'tool', toolId: tool.id, text: res.summary });
      step += 1;
      await bumpSessionUsage(session.id, { steps: 1, toolCalls: 1 });
      continue;
    }

    // WRITE (or read requiring approval) → pause for human approval.
    const idem = idempotencyKey(session.id, tool.id, hash);
    const action = await createAction({ agentSessionId: session.id, toolId: tool.id, connectionId: entry.connectionId, riskLevel: tool.risk, reversibility: tool.reversibility, approvalStatus: 'AWAITING_APPROVAL', normalizedArguments: normalized, argumentsHash: hash, status: 'PROPOSED', idempotencyKey: idem });
    const preview = buildActionPreview(tool, normalized, true);
    const approval = await createApproval({ actionId: action.id, agentSessionId: session.id, userId: rc.userId, organizationId: rc.organizationId, toolId: tool.id, riskLevel: tool.risk, argumentsHash: hash, preview });
    await addStep({ agentSessionId: session.id, stepIndex: step, stepType: 'TOOL_WRITE', toolId: tool.id, actionId: action.id, status: 'PENDING', inputSummary: decision.note ?? tool.description, outputSummary: 'Awaiting approval' });
    await logSecurityEvent({ event: 'agent.approval_requested', userId: rc.userId, actorUserId: rc.userId, organizationId: rc.organizationId, metadata: { sessionId: session.id, toolId: tool.id, risk: tool.risk } });
    await setSessionStatus(session.id, 'AWAITING_APPROVAL');
    return { status: 'AWAITING_APPROVAL', message: 'Waiting for your approval to continue.', approval: { id: approval.id, expiresAt: approval.expiresAt.toISOString(), preview }, actionId: action.id };
  }
}

async function finalize(sessionId: string, status: AgentSession['status'], message: string): Promise<AgentRunResult> {
  const extra = status === 'COMPLETED' ? { completedAt: new Date() } : {};
  await setSessionStatus(sessionId, status, extra);
  const event = status === 'COMPLETED' ? 'agent.session_completed' : status === 'CANCELED' ? 'agent.session_canceled' : 'agent.session_blocked';
  const session = await getSession(sessionId);
  await logSecurityEvent({ event, userId: session?.userId ?? null, actorUserId: session?.userId ?? null, organizationId: session?.organizationId ?? null, metadata: { sessionId, status } });
  return { status, message };
}

/**
 * Resume a run after the user APPROVED a write. Executes the approved action
 * (with all live rechecks + single-use approval consume), records verification,
 * then continues the bounded loop so the model can confirm and finish.
 */
export async function resumeAfterApproval(rc: RunContext, action: AgentAction, approval: ApprovalRequest): Promise<AgentRunResult> {
  const policy = await resolveEffectivePolicy({ userId: rc.userId, organizationId: rc.organizationId });
  const res = await executeWriteAction({
    action,
    userId: rc.userId,
    organizationId: rc.organizationId,
    mode: rc.session.mode,
    policy,
    planSlug: rc.planSlug,
    normalizedArgs: (action.normalizedArguments ?? {}) as Record<string, unknown>,
    argumentsHash: approval.argumentsHash,
    requestId: null,
    signal: rc.signal,
    dryRun: rc.session.dryRun,
  });

  const outcomeText =
    res.status === 'SUCCEEDED'
      ? `Action ${action.toolId} completed and was verified (id ${res.externalResourceId}).`
      : res.status === 'UNKNOWN_OUTCOME'
        ? `Action ${action.toolId} could NOT be confirmed. Tell the user it is unverified; do not claim success.`
        : `Action ${action.toolId} did not complete (${res.summary}).`;
  await addStep({ agentSessionId: rc.session.id, stepIndex: rc.session.stepsUsed, stepType: 'VERIFY', toolId: action.toolId, actionId: action.id, status: res.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED', outputSummary: outcomeText });
  await bumpSessionUsage(rc.session.id, { steps: 1 });

  // Continue the loop so the model can verify + produce a final answer.
  const fresh = await getSession(rc.session.id);
  return advanceAgentSession({ ...rc, session: fresh! });
}

/** Cancel a run: stop future steps + pending (not-yet-started) actions. */
export async function cancelAgentSession(sessionId: string): Promise<void> {
  await setSessionStatus(sessionId, 'CANCELED', { canceledAt: new Date() });
}

export { getAction };
