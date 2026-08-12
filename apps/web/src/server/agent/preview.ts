import type { AgentTool } from './tool-catalog';
import type { AgentRiskLevel, Reversibility } from './risk';

/**
 * ActionPreview — a consistent, user-facing description of what an action WILL do,
 * derived from the normalized (approved) arguments. Previews never contain secrets
 * or tokens. The execution payload is derived from the SAME approved preview, so
 * what the user saw is exactly what runs.
 */

export interface ActionPreview {
  actionType: string;
  toolId: string;
  connectorSlug: string;
  riskLevel: AgentRiskLevel;
  reversibility: Reversibility;
  requiresApproval: boolean;
  title: string;
  description: string;
  affectedResources: string[];
  recipient?: string;
  destination?: string;
  contentPreview?: string;
  fields?: Array<{ label: string; value: string }>;
}

function truncate(s: string, n = 400): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Build a preview for a proposed action from its NORMALIZED arguments. */
export function buildActionPreview(tool: AgentTool, args: Record<string, unknown>, requiresApproval: boolean): ActionPreview {
  const base: ActionPreview = {
    actionType: tool.previewKind,
    toolId: tool.id,
    connectorSlug: tool.connectorSlug,
    riskLevel: tool.risk,
    reversibility: tool.reversibility,
    requiresApproval,
    title: tool.description,
    description: tool.description,
    affectedResources: [],
  };

  switch (tool.previewKind) {
    case 'email':
    case 'draft': {
      const a = args as { to?: string[]; cc?: string[]; subject?: string; body?: string };
      const send = tool.previewKind === 'email';
      return {
        ...base,
        title: send ? 'Send email' : 'Create email draft',
        description: send ? 'This action will send an external message.' : 'This creates a draft; nothing is sent.',
        recipient: (a.to ?? []).join(', '),
        contentPreview: truncate(a.body ?? ''),
        affectedResources: [...(a.to ?? []), ...(a.cc ?? [])],
        fields: [
          { label: 'To', value: (a.to ?? []).join(', ') },
          ...(a.cc?.length ? [{ label: 'Cc', value: a.cc.join(', ') }] : []),
          { label: 'Subject', value: a.subject ?? '' },
        ],
      };
    }
    case 'calendar': {
      const a = args as { title?: string; date?: string; time?: string; guests?: string[]; location?: string };
      return {
        ...base,
        title: 'Create meeting',
        description: 'This will create a calendar event and may notify guests.',
        destination: 'Primary calendar',
        affectedResources: a.guests ?? [],
        fields: [
          { label: 'Title', value: a.title ?? '' },
          { label: 'Date', value: a.date ?? '' },
          { label: 'Time', value: a.time ?? '' },
          { label: 'Guests', value: (a.guests ?? []).join(', ') },
          ...(a.location ? [{ label: 'Location', value: a.location }] : []),
        ],
      };
    }
    case 'slack': {
      const a = args as { channel?: string; message?: string };
      return {
        ...base,
        title: 'Post Slack message',
        description: 'This will post an external message to a Slack channel.',
        destination: a.channel,
        contentPreview: truncate(a.message ?? ''),
        affectedResources: a.channel ? [a.channel] : [],
        fields: [{ label: 'Channel', value: a.channel ?? '' }],
      };
    }
    case 'crm': {
      const a = args as { recordId?: string; changes?: Record<string, unknown> };
      const changes = Object.entries(a.changes ?? {}).map(([k, v]) => ({ label: k, value: String(v) }));
      return {
        ...base,
        title: 'Update record',
        description: 'This will modify a CRM record.',
        destination: a.recordId,
        affectedResources: a.recordId ? [a.recordId] : [],
        fields: changes,
      };
    }
    case 'delete': {
      const a = args as { externalId?: string };
      return { ...base, title: 'Delete resource', description: 'This will permanently delete a resource.', affectedResources: a.externalId ? [a.externalId] : [] };
    }
    default:
      return base;
  }
}
