/**
 * Built-in workflow templates — STRUCTURE ONLY (no credentials, connections, or
 * secrets). A user instantiates a template into their workspace, then chooses the
 * connection / schedule / recipients / approval policy. Nothing here auto-enables
 * an unsafe default; instantiated workflows always start as DRAFT.
 */

export interface WorkflowTemplate {
  slug: string;
  name: string;
  description: string;
  goal: string;
  suggestedTrigger: { type: 'SCHEDULE' | 'CONDITION'; pattern?: 'daily' | 'weekly' | 'monthly'; time?: string; weekday?: number; checkIntervalMinutes?: number };
  approvalPolicy: 'READ_ONLY_AUTOMATIC' | 'ASK_EVERY_WRITE';
  needsConnectors: boolean;
  needsWrite: boolean;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    slug: 'morning-email-brief',
    name: 'Morning Email Brief',
    description: 'Every weekday morning, summarize important unread emails.',
    goal: 'Find important unread emails received since the previous run and prepare a concise briefing of the key items. Do not send anything.',
    suggestedTrigger: { type: 'SCHEDULE', pattern: 'daily', time: '08:00' },
    approvalPolicy: 'READ_ONLY_AUTOMATIC',
    needsConnectors: true,
    needsWrite: false,
  },
  {
    slug: 'weekly-sales-review',
    name: 'Weekly Sales Review',
    description: 'Every Monday, prepare a sales pipeline summary.',
    goal: 'Summarize the current sales pipeline and highlight deals that need attention this week.',
    suggestedTrigger: { type: 'SCHEDULE', pattern: 'weekly', time: '08:00', weekday: 1 },
    approvalPolicy: 'READ_ONLY_AUTOMATIC',
    needsConnectors: true,
    needsWrite: false,
  },
  {
    slug: 'stale-crm-opportunities',
    name: 'Stale CRM Opportunities',
    description: 'Daily, flag opportunities with no activity for 7 days.',
    goal: 'Check the CRM and flag opportunities with no activity in the last 7 days; prepare a short list for review.',
    suggestedTrigger: { type: 'CONDITION', checkIntervalMinutes: 1440 },
    approvalPolicy: 'READ_ONLY_AUTOMATIC',
    needsConnectors: true,
    needsWrite: false,
  },
  {
    slug: 'weekly-management-report',
    name: 'Weekly Management Report',
    description: 'Every Friday, generate a management report from knowledge base + sales data.',
    goal: 'Generate the weekly management report from the organization knowledge base and connected sales data. Prepare it for review before any sending.',
    suggestedTrigger: { type: 'SCHEDULE', pattern: 'weekly', time: '16:00', weekday: 5 },
    approvalPolicy: 'ASK_EVERY_WRITE',
    needsConnectors: true,
    needsWrite: true,
  },
  {
    slug: 'knowledge-base-digest',
    name: 'Knowledge Base Digest',
    description: 'Weekly digest of new material added to a knowledge base.',
    goal: 'Summarize new documents added to the selected knowledge base this week.',
    suggestedTrigger: { type: 'SCHEDULE', pattern: 'weekly', time: '09:00', weekday: 1 },
    approvalPolicy: 'READ_ONLY_AUTOMATIC',
    needsConnectors: false,
    needsWrite: false,
  },
];

export function getTemplate(slug: string): WorkflowTemplate | null {
  return WORKFLOW_TEMPLATES.find((t) => t.slug === slug) ?? null;
}
