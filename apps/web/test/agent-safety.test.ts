import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Plan, AgentPolicy } from '@/server/db/schema';
import { AGENT_TOOLS, getAgentTool, buildToolCatalog, emailSendSchema } from '@/server/agent/tool-catalog';
import { DEFAULT_RISK_POLICY, isReadRisk } from '@/server/agent/risk';
import { decidePolicy } from '@/server/agent/policy';
import { combinePolicies, type EffectivePolicy } from '@/server/agent/policies-store';
import { normalizeArguments, hashArguments, idempotencyKey } from '@/server/agent/hashing';
import { buildActionPreview } from '@/server/agent/preview';
import { parseDecision } from '@/server/agent/orchestrator';
import { AGENT_PROTOCOL, renderAgentState } from '@/server/agent/agent-prompt';
import { getWriteAdapter, _resetWriteAdapters, _mockWriteAdapter } from '@/server/agent/write-adapters';

const PLAN = { connectorsEnabled: true, agentEnabled: true } as unknown as Plan;
const PERMISSIVE: EffectivePolicy = {
  agentEnabled: true,
  writeActionsEnabled: true,
  emailSendingEnabled: true,
  calendarActionsEnabled: true,
  slackPostingEnabled: true,
  crmWritesEnabled: true,
  maxStepsPerSession: null,
  toolOverrides: {},
  crossConnectorTransfer: 'REQUIRE_APPROVAL',
};

const withWrites = <T>(fn: () => T): T => {
  const prev = process.env.AGENT_WRITE_ACTIONS_ENABLED;
  process.env.AGENT_WRITE_ACTIONS_ENABLED = 'true';
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.AGENT_WRITE_ACTIONS_ENABLED;
    else process.env.AGENT_WRITE_ACTIONS_ENABLED = prev;
  }
};

describe('tool allowlist (no arbitrary execution)', () => {
  it('has NO arbitrary HTTP / URL / shell / fetch tool', () => {
    for (const t of AGENT_TOOLS) expect(t.id).not.toMatch(/http|url|fetch|arbitrary|shell|exec|request/i);
    expect(getAgentTool('http.request')).toBeNull();
    expect(getAgentTool('drive.search')?.kind).toBe('read');
    expect(getAgentTool('gmail.send')?.kind).toBe('write');
  });

  it('classifies risk correctly and read vs write is coherent', () => {
    expect(getAgentTool('gmail.search')?.risk).toBe('READ_ONLY');
    expect(getAgentTool('gmail.send')?.risk).toBe('EXTERNAL_COMMUNICATION');
    expect(getAgentTool('gmail.createDraft')?.risk).toBe('REVERSIBLE_WRITE');
    expect(getAgentTool('drive.delete')?.risk).toBe('DESTRUCTIVE');
    expect(isReadRisk('READ_ONLY')).toBe(true);
    expect(isReadRisk('EXTERNAL_COMMUNICATION')).toBe(false);
  });
});

describe('tool schema validation', () => {
  it('validates recipients and rejects unknown fields + oversized recipient lists', () => {
    expect(() => emailSendSchema.parse({ to: ['a@b.com'], subject: 's', body: 'b' })).not.toThrow();
    expect(() => emailSendSchema.parse({ to: ['not-an-email'], subject: 's', body: 'b' })).toThrow();
    expect(() => emailSendSchema.parse({ to: ['a@b.com'], subject: 's', body: 'b', evil: 1 })).toThrow();
    const many = Array.from({ length: 11 }, (_, i) => `u${i}@b.com`);
    expect(() => emailSendSchema.parse({ to: many, subject: 's', body: 'b' })).toThrow(); // mass-action limit
  });
});

describe('tool catalog filtering', () => {
  const activeGmail = [{ id: 'c1', connectorSlug: 'gmail', status: 'ACTIVE', capabilities: ['SEARCH', 'READ'] }];

  it('CHAT mode exposes no tools; plan without connectors exposes none', () => {
    expect(buildToolCatalog({ mode: 'CHAT', plan: PLAN, connections: activeGmail })).toHaveLength(0);
    expect(buildToolCatalog({ mode: 'AGENT', plan: { connectorsEnabled: false } as unknown as Plan, connections: activeGmail })).toHaveLength(0);
  });

  it('only surfaces tools with an ACTIVE connection', () => {
    const cat = buildToolCatalog({ mode: 'AGENT', plan: PLAN, connections: activeGmail });
    const ids = cat.map((c) => c.toolId);
    expect(ids).toContain('gmail.search');
    expect(ids).not.toContain('drive.search'); // no drive connection
  });

  it('hides write tools when the mode disallows writes', () => {
    const cat = buildToolCatalog({ mode: 'AGENT', plan: PLAN, connections: activeGmail, writesAllowedByMode: false });
    expect(cat.every((c) => c.kind === 'read')).toBe(true);
  });

  it('omits a policy-denied tool entirely', () => {
    const cat = buildToolCatalog({ mode: 'AGENT', plan: PLAN, connections: activeGmail, deniedToolIds: new Set(['gmail.send']) });
    expect(cat.map((c) => c.toolId)).not.toContain('gmail.send');
  });
});

describe('action policy engine', () => {
  const send = getAgentTool('gmail.send')!;
  const search = getAgentTool('gmail.search')!;
  const del = getAgentTool('drive.delete')!;

  it('reads are allowed; external comms require approval; destructive is denied', () =>
    withWrites(() => {
      expect(decidePolicy({ tool: search, mode: 'AGENT', policy: PERMISSIVE }).decision).toBe('ALLOW');
      expect(decidePolicy({ tool: send, mode: 'AGENT', policy: PERMISSIVE }).decision).toBe('REQUIRE_APPROVAL');
      expect(decidePolicy({ tool: del, mode: 'AGENT', policy: PERMISSIVE }).decision).toBe('DENY');
    }));

  it('a write is DENIED when the platform write switch is off (default)', () => {
    const prev = process.env.AGENT_WRITE_ACTIONS_ENABLED;
    delete process.env.AGENT_WRITE_ACTIONS_ENABLED;
    expect(decidePolicy({ tool: send, mode: 'AGENT', policy: PERMISSIVE }).decision).toBe('DENY');
    if (prev !== undefined) process.env.AGENT_WRITE_ACTIONS_ENABLED = prev;
  });

  it('an ALLOW override can NOT downgrade an external communication below approval', () =>
    withWrites(() => {
      const policy = { ...PERMISSIVE, toolOverrides: { 'gmail.send': 'ALLOW' as const } };
      expect(decidePolicy({ tool: send, mode: 'AGENT', policy }).decision).toBe('REQUIRE_APPROVAL');
    }));

  it('a DENY override always wins; a disabled category denies the whole tool', () =>
    withWrites(() => {
      expect(decidePolicy({ tool: send, mode: 'AGENT', policy: { ...PERMISSIVE, toolOverrides: { 'gmail.send': 'DENY' } } }).decision).toBe('DENY');
      expect(decidePolicy({ tool: send, mode: 'AGENT', policy: { ...PERMISSIVE, emailSendingEnabled: false } }).decision).toBe('DENY');
    }));

  it('CHAT mode denies all tools; disabled agent denies all', () => {
    expect(decidePolicy({ tool: search, mode: 'CHAT', policy: PERMISSIVE }).decision).toBe('DENY');
    expect(decidePolicy({ tool: search, mode: 'AGENT', policy: { ...PERMISSIVE, agentEnabled: false } }).decision).toBe('DENY');
  });

  it('default risk policy denies financial + high-risk', () => {
    expect(DEFAULT_RISK_POLICY.FINANCIAL_OR_COMMITMENT).toBe('DENY');
    expect(DEFAULT_RISK_POLICY.HIGH_RISK).toBe('DENY');
  });
});

describe('policy precedence (Platform → Org → User, most restrictive wins)', () => {
  const row = (scope: AgentPolicy['scope'], patch: Partial<AgentPolicy>): AgentPolicy =>
    ({ id: 'x', scope, scopeId: null, agentEnabled: null, writeActionsEnabled: null, emailSendingEnabled: null, calendarActionsEnabled: null, slackPostingEnabled: null, crmWritesEnabled: null, maxStepsPerSession: null, toolOverrides: {}, crossConnectorTransfer: null, updatedByUserId: null, createdAt: new Date(), updatedAt: new Date(), ...patch }) as AgentPolicy;

  it('an org disabling email sending overrides a permissive platform', () => {
    const eff = combinePolicies(row('PLATFORM', { emailSendingEnabled: true }), row('ORGANIZATION', { emailSendingEnabled: false }), null);
    expect(eff.emailSendingEnabled).toBe(false);
  });

  it('a user DENY override is not loosened by platform ALLOW; min step cap wins', () => {
    const eff = combinePolicies(
      row('PLATFORM', { toolOverrides: { 'gmail.send': 'ALLOW' }, maxStepsPerSession: 12 }),
      row('ORGANIZATION', { maxStepsPerSession: 6 }),
      row('USER', { toolOverrides: { 'gmail.send': 'DENY' } }),
    );
    expect(eff.toolOverrides['gmail.send']).toBe('DENY');
    expect(eff.maxStepsPerSession).toBe(6);
  });
});

describe('argument hashing + approval binding', () => {
  const send = getAgentTool('gmail.send')!;

  it('hash is stable regardless of key order but changes when the recipient changes', () => {
    const a = normalizeArguments(send, { subject: 'Hi', to: ['a@b.com'], body: 'x' });
    const b = normalizeArguments(send, { to: ['a@b.com'], body: 'x', subject: 'Hi' });
    expect(hashArguments(send.id, a)).toBe(hashArguments(send.id, b));
    const c = normalizeArguments(send, { to: ['evil@b.com'], body: 'x', subject: 'Hi' });
    expect(hashArguments(send.id, c)).not.toBe(hashArguments(send.id, a));
  });

  it('idempotency key is deterministic per (session, tool, argsHash)', () => {
    const h = hashArguments(send.id, normalizeArguments(send, { to: ['a@b.com'], subject: 's', body: 'b' }));
    expect(idempotencyKey('sess-1', send.id, h)).toBe(idempotencyKey('sess-1', send.id, h));
    expect(idempotencyKey('sess-1', send.id, h)).not.toBe(idempotencyKey('sess-2', send.id, h));
  });
});

describe('action preview (no secrets, correct routing)', () => {
  it('renders an email preview from normalized args', () => {
    const send = getAgentTool('gmail.send')!;
    const p = buildActionPreview(send, { to: ['ops@supplier.com'], subject: 'Delivery date?', body: 'Please confirm.' }, true);
    expect(p.title).toBe('Send email');
    expect(p.recipient).toBe('ops@supplier.com');
    expect(p.requiresApproval).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/accessToken|Bearer|refreshToken/i);
  });
});

describe('agent decision parsing', () => {
  it('parses plan / tool / final and rejects malformed output', () => {
    expect(parseDecision('{"type":"plan","steps":["a","b"]}')).toEqual({ type: 'plan', steps: ['a', 'b'] });
    expect(parseDecision('Sure! {"type":"tool","toolId":"gmail.search","arguments":{"query":"x"}} done')).toMatchObject({ type: 'tool', toolId: 'gmail.search' });
    expect(parseDecision('{"type":"final","message":"hello"}')).toEqual({ type: 'final', message: 'hello' });
    expect(parseDecision('no json here')).toBeNull();
    expect(parseDecision('{"type":"nonsense"}')).toBeNull();
  });
});

describe('agent system prompt', () => {
  it('states the core safety invariants', () => {
    const p = AGENT_PROTOCOL.toLowerCase();
    expect(p).toContain('capabilities, not authority');
    expect(p).toContain('untrusted data');
    expect(p).toContain('never claim an action succeeded');
    const state = renderAgentState({ goal: 'g', catalog: [{ toolId: 'gmail.search', connectionId: 'c', connectorSlug: 'gmail', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', description: 'Search Gmail' }], history: [], needPlan: true });
    expect(state).toContain('gmail.search');
    expect(state).toContain('USER GOAL: g');
  });
});

describe('write adapter idempotency + verification', () => {
  beforeEach(() => _resetWriteAdapters());
  afterEach(() => _resetWriteAdapters());
  const cred = { accessToken: 'server-only' } as never;

  it('a verified write returns a provider id; the same key never causes a second side effect', async () => {
    const adapter = getWriteAdapter('mock')!;
    const ctx = { operation: 'send', args: { to: ['a@b.com'] }, idempotencyKey: 'k-1' };
    const first = await adapter.perform(cred, ctx);
    expect(first.outcome).toBe('SUCCEEDED');
    expect(first.externalResourceId).toBeTruthy();
    const second = await adapter.perform(cred, ctx);
    expect(second.outcome).toBe('SUCCEEDED');
    expect(second.deduped).toBe(true);
    expect(second.externalResourceId).toBe(first.externalResourceId); // no duplicate send
  });

  it('a provider timeout is reported as UNKNOWN_OUTCOME (never a success)', async () => {
    _mockWriteAdapter('mock').setBehavior('timeout');
    const res = await getWriteAdapter('mock')!.perform(cred, { operation: 'send', args: {}, idempotencyKey: 'k-2' });
    expect(res.outcome).toBe('UNKNOWN_OUTCOME');
    expect(res.externalResourceId).toBeUndefined();
  });
});
