/**
 * Action-risk taxonomy for the agent engine (Phase 11).
 *
 * Risk classification is CENTRALIZED here and drives the default action policy.
 * The model never sets or changes an action's risk — BIINA does. The default
 * policy is deliberately conservative: anything that leaves BIINA (external
 * communication) requires human approval, and destructive / financial actions
 * are denied outright in Phase 11.
 */

export type AgentRiskLevel =
  | 'READ_ONLY'
  | 'REVERSIBLE_WRITE'
  | 'EXTERNAL_COMMUNICATION'
  | 'FINANCIAL_OR_COMMITMENT'
  | 'DESTRUCTIVE'
  | 'HIGH_RISK';

export type Reversibility = 'REVERSIBLE' | 'PARTIALLY_REVERSIBLE' | 'IRREVERSIBLE';

/** A policy DECISION for a single action. BIINA is always the authority. */
export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

/**
 * Conservative default policy per risk level. Phase 11 does NOT autonomously run
 * external communications, and denies destructive / financial actions entirely.
 */
export const DEFAULT_RISK_POLICY: Record<AgentRiskLevel, PolicyDecision> = {
  READ_ONLY: 'ALLOW',
  REVERSIBLE_WRITE: 'REQUIRE_APPROVAL',
  EXTERNAL_COMMUNICATION: 'REQUIRE_APPROVAL',
  FINANCIAL_OR_COMMITMENT: 'DENY',
  DESTRUCTIVE: 'DENY',
  HIGH_RISK: 'DENY',
};

export const isReadRisk = (r: AgentRiskLevel): boolean => r === 'READ_ONLY';
export const isWriteRisk = (r: AgentRiskLevel): boolean => !isReadRisk(r);

// ---- Platform kill switches (server-controlled feature flags) ----

/**
 * Master kill switch. When false, the platform stops accepting NEW agent runs.
 * Defaults ON so the engine is usable, but every write still needs its own gate.
 */
export function agentExecutionEnabled(): boolean {
  return process.env.AGENT_EXECUTION_ENABLED !== 'false';
}

/**
 * Global write kill switch. When false, NO external write executes regardless of
 * approval — reads still work. Defaults OFF: writes are opt-in for the platform.
 */
export function agentWriteActionsEnabled(): boolean {
  return process.env.AGENT_WRITE_ACTIONS_ENABLED === 'true';
}

/** Dry-run mode: plan + preview + safe reads, but never execute external writes. */
export function agentDryRunForced(): boolean {
  return process.env.AGENT_DRY_RUN === 'true';
}

/** Per-tool kill switch, e.g. AGENT_DISABLED_TOOLS="gmail.send,slack.post". */
export function toolKilled(toolId: string): boolean {
  const raw = process.env.AGENT_DISABLED_TOOLS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(toolId);
}
