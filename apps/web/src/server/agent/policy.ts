import type { AgentTool } from './tool-catalog';
import type { EffectivePolicy } from './policies-store';
import { DEFAULT_RISK_POLICY, agentWriteActionsEnabled, toolKilled, type PolicyDecision } from './risk';

/**
 * ActionPolicyService — the SINGLE authority that decides whether a proposed tool
 * action is ALLOW / REQUIRE_APPROVAL / DENY. The model's request is only an input;
 * BIINA decides. Policy precedence (each layer can only TIGHTEN the result):
 *
 *     Platform safety → Organization policy → User policy → Agent mode → Risk default
 *
 * The most restrictive applicable rule always wins. In Phase 11, external
 * communications are never auto-run, and destructive / financial actions are denied.
 */

const RANK: Record<PolicyDecision, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };
const tighten = (a: PolicyDecision, b: PolicyDecision): PolicyDecision => (RANK[a] >= RANK[b] ? a : b);

export interface PolicyInput {
  tool: AgentTool;
  mode: 'CHAT' | 'ASSISTED' | 'AGENT';
  policy: EffectivePolicy;
  /** True if this action moves data between two different connectors. */
  crossConnector?: boolean;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

/** Category master switch for a write tool (email/calendar/slack/crm). */
function categoryDisabled(tool: AgentTool, policy: EffectivePolicy): boolean {
  switch (tool.connectorSlug) {
    case 'gmail':
      return tool.kind === 'write' && !policy.emailSendingEnabled;
    case 'google-calendar':
      return tool.kind === 'write' && !policy.calendarActionsEnabled;
    case 'slack':
      return tool.kind === 'write' && !policy.slackPostingEnabled;
    case 'crm':
      return tool.kind === 'write' && !policy.crmWritesEnabled;
    default:
      return false;
  }
}

export function decidePolicy(input: PolicyInput): PolicyResult {
  const { tool, mode, policy } = input;

  // 0. Mode: CHAT never uses tools.
  if (mode === 'CHAT') return { decision: 'DENY', reason: 'Chat mode does not use tools.' };

  // 1. Kill switches (platform-level, non-negotiable).
  if (toolKilled(tool.id)) return { decision: 'DENY', reason: 'Tool disabled by platform kill switch.' };
  if (!policy.agentEnabled) return { decision: 'DENY', reason: 'Agent disabled by policy.' };

  // 2. Start from the conservative risk default.
  let decision = DEFAULT_RISK_POLICY[tool.risk];
  let reason = `Risk ${tool.risk} → ${decision} by default.`;

  // 3. Writes: global + policy write gates, and category switches.
  if (tool.kind === 'write') {
    if (!agentWriteActionsEnabled()) return { decision: 'DENY', reason: 'External writes are disabled platform-wide.' };
    if (!policy.writeActionsEnabled) return { decision: 'DENY', reason: 'Write actions disabled by policy.' };
    if (categoryDisabled(tool, policy)) return { decision: 'DENY', reason: `${tool.connectorSlug} writes disabled by policy.` };
    // Phase 11 never lets a write run silently: floor at REQUIRE_APPROVAL.
    if (decision === 'ALLOW') decision = 'REQUIRE_APPROVAL';
  }

  // 4. Per-tool override (can only tighten; ALLOW never lowers below the risk floor).
  const override = policy.toolOverrides[tool.id];
  if (override) {
    if (override === 'DENY') return { decision: 'DENY', reason: `Tool ${tool.id} denied by policy override.` };
    if (override === 'REQUIRE_APPROVAL') {
      decision = tighten(decision, 'REQUIRE_APPROVAL');
      reason = `Policy override requires approval for ${tool.id}.`;
    }
    // override ALLOW is intentionally ignored for writes (cannot loosen the floor).
  }

  // 5. Cross-connector data movement — never silent; a scope may DENY it.
  if (input.crossConnector && tool.kind === 'write') {
    if (policy.crossConnectorTransfer === 'DENY') return { decision: 'DENY', reason: 'Cross-connector data transfer is denied by policy.' };
    decision = tighten(decision, 'REQUIRE_APPROVAL');
    reason = 'Cross-connector transfer requires approval.';
  }

  return { decision, reason };
}
