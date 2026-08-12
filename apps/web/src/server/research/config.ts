/**
 * Research platform config + HARD limits. These ceilings are server-authoritative
 * and can NEVER be raised by model-generated plans or by source content. Effective
 * budget = min(platform, plan, depth, session).
 */

export function advancedResearchEnabled(): boolean {
  return process.env.ADVANCED_RESEARCH_ENABLED !== 'false';
}
/** When false, multi-agent research still plans/runs but only sequentially (1 agent). */
export function multiAgentResearchEnabled(): boolean {
  return process.env.MULTI_AGENT_RESEARCH_ENABLED !== 'false';
}
/** Web research kill switch — research can continue on internal data when off. */
export function researchWebEnabled(): boolean {
  return process.env.RESEARCH_WEB_ENABLED !== 'false';
}
/** A specialist profile can be disabled by id, e.g. RESEARCH_DISABLED_PROFILES="fact-checker". */
export function profileDisabled(profileId: string): boolean {
  return (process.env.RESEARCH_DISABLED_PROFILES ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(profileId);
}

// ---- Hard platform ceilings (a plan/depth can only be MORE restrictive) ----

export function hardMaxParallelAgents(): number {
  const n = Number(process.env.RESEARCH_MAX_PARALLEL_AGENTS);
  return Number.isFinite(n) && n > 0 ? n : 4;
}
export function hardMaxTotalAgentRuns(): number {
  const n = Number(process.env.RESEARCH_MAX_TOTAL_AGENT_RUNS);
  return Number.isFinite(n) && n > 0 ? n : 12;
}
export function hardMaxTasks(): number {
  const n = Number(process.env.RESEARCH_MAX_TASKS);
  return Number.isFinite(n) && n > 0 ? n : 8;
}
export function hardMaxSources(): number {
  const n = Number(process.env.RESEARCH_MAX_SOURCES);
  return Number.isFinite(n) && n > 0 ? n : 40;
}
export function hardMaxRuntimeMs(): number {
  const n = Number(process.env.RESEARCH_MAX_RUNTIME_MS);
  return Number.isFinite(n) && n > 0 ? n : 240_000;
}
/** Delegation depth is fixed at 1 in Phase 15: orchestrator → specialist. No nesting. */
export const MAX_DELEGATION_DEPTH = 1;

export type Depth = 'QUICK' | 'STANDARD' | 'DEEP';

export interface DepthBudget {
  maxTasks: number;
  maxAgentRuns: number;
  maxSources: number;
  maxParallelAgents: number;
  maxDurationMs: number;
}

/** Map a depth level to bounded resources (clamped to platform ceilings). */
export function depthBudget(depth: Depth): DepthBudget {
  const base: Record<Depth, DepthBudget> = {
    QUICK: { maxTasks: 2, maxAgentRuns: 3, maxSources: 6, maxParallelAgents: 2, maxDurationMs: 90_000 },
    STANDARD: { maxTasks: 4, maxAgentRuns: 6, maxSources: 16, maxParallelAgents: 3, maxDurationMs: 180_000 },
    DEEP: { maxTasks: 6, maxAgentRuns: 10, maxSources: 30, maxParallelAgents: 3, maxDurationMs: 240_000 },
  };
  const b = base[depth];
  return {
    maxTasks: Math.min(b.maxTasks, hardMaxTasks()),
    maxAgentRuns: Math.min(b.maxAgentRuns, hardMaxTotalAgentRuns()),
    maxSources: Math.min(b.maxSources, hardMaxSources()),
    maxParallelAgents: Math.min(b.maxParallelAgents, hardMaxParallelAgents(), multiAgentResearchEnabled() ? hardMaxParallelAgents() : 1),
    maxDurationMs: Math.min(b.maxDurationMs, hardMaxRuntimeMs()),
  };
}
