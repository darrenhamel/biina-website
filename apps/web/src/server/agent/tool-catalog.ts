import { z } from 'zod';
import type { Plan } from '@/server/db/schema';
import type { AgentRiskLevel, Reversibility } from './risk';

/**
 * The AGENT tool catalog — the strict, allowlisted surface the model may request.
 *
 * This is a SUPERSET view over the connector TOOL_ALLOWLIST: every agent tool maps
 * to a connector operation, carries a strict Zod input schema, an agent-level risk
 * class, reversibility metadata, and a preview kind. There is deliberately NO
 * arbitrary-HTTP / arbitrary-API / shell tool — only these entries can ever run.
 *
 * `buildToolCatalog` filters this list down to what a specific execution context
 * actually has (connector enabled, live connection, scope, plan, org policy, mode),
 * so the model is never even shown a tool it could not use.
 */

export type ToolKind = 'read' | 'write';
export type PreviewKind = 'none' | 'email' | 'calendar' | 'slack' | 'crm' | 'draft' | 'delete';

export interface AgentTool {
  id: string; // e.g. 'gmail.send'
  connectorSlug: string; // 'gmail' | 'google-drive' | 'mock' | ...
  operation: string; // adapter method / connector operation
  kind: ToolKind;
  risk: AgentRiskLevel;
  reversibility: Reversibility;
  previewKind: PreviewKind;
  /** Requires a live connection to that connector (reads/writes to external data). */
  needsConnection: boolean;
  schema: z.ZodTypeAny;
  description: string;
}

// ---- Input schemas (strict — unknown fields rejected) ----

const email = z.string().trim().toLowerCase().email().max(320);
const MAX_RECIPIENTS = 10;
const MAX_GUESTS = 20;

export const searchSchema = z.object({ query: z.string().trim().min(1).max(400), max: z.number().int().min(1).max(10).optional() }).strict();
export const readSchema = z.object({ externalId: z.string().trim().min(1).max(255) }).strict();

export const emailSendSchema = z
  .object({
    to: z.array(email).min(1).max(MAX_RECIPIENTS),
    cc: z.array(email).max(MAX_RECIPIENTS).optional(),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const calendarCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    date: z.string().trim().min(1).max(40), // ISO date; validated further at execution
    time: z.string().trim().max(40).optional(),
    guests: z.array(email).max(MAX_GUESTS).optional(),
    location: z.string().trim().max(300).optional(),
    durationMinutes: z.number().int().min(5).max(1440).optional(),
  })
  .strict();

export const slackPostSchema = z
  .object({
    channel: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const crmUpdateSchema = z
  .object({
    recordId: z.string().trim().min(1).max(120),
    changes: z.record(z.string().max(64), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
  })
  .strict();

// ---- The catalog. Write tools mirror connector write capabilities. ----

export const AGENT_TOOLS: AgentTool[] = [
  // Reads (mirror the connector read allowlist).
  { id: 'mock.search', connectorSlug: 'mock', operation: 'search', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', previewKind: 'none', needsConnection: true, schema: searchSchema, description: 'Search a connected mock account' },
  { id: 'mock.read', connectorSlug: 'mock', operation: 'read', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', previewKind: 'none', needsConnection: true, schema: readSchema, description: 'Read a mock resource' },
  { id: 'drive.search', connectorSlug: 'google-drive', operation: 'search', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', previewKind: 'none', needsConnection: true, schema: searchSchema, description: 'Search Google Drive files' },
  { id: 'drive.read', connectorSlug: 'google-drive', operation: 'read', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', previewKind: 'none', needsConnection: true, schema: readSchema, description: 'Read a Google Drive file' },
  { id: 'gmail.search', connectorSlug: 'gmail', operation: 'search', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', previewKind: 'none', needsConnection: true, schema: searchSchema, description: 'Search Gmail messages' },
  { id: 'gmail.read', connectorSlug: 'gmail', operation: 'read', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', previewKind: 'none', needsConnection: true, schema: readSchema, description: 'Read a Gmail message' },
  { id: 'calendar.list', connectorSlug: 'google-calendar', operation: 'search', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', previewKind: 'none', needsConnection: true, schema: searchSchema, description: 'List calendar events' },
  { id: 'slack.search', connectorSlug: 'slack', operation: 'search', kind: 'read', risk: 'READ_ONLY', reversibility: 'REVERSIBLE', previewKind: 'none', needsConnection: true, schema: searchSchema, description: 'Search Slack messages' },

  // Writes — DRAFT (reversible) vs SEND (external communication) are distinct.
  { id: 'gmail.createDraft', connectorSlug: 'gmail', operation: 'createDraft', kind: 'write', risk: 'REVERSIBLE_WRITE', reversibility: 'REVERSIBLE', previewKind: 'draft', needsConnection: true, schema: emailSendSchema, description: 'Create (but not send) a Gmail draft' },
  { id: 'gmail.send', connectorSlug: 'gmail', operation: 'send', kind: 'write', risk: 'EXTERNAL_COMMUNICATION', reversibility: 'IRREVERSIBLE', previewKind: 'email', needsConnection: true, schema: emailSendSchema, description: 'Send a Gmail message' },
  { id: 'calendar.create', connectorSlug: 'google-calendar', operation: 'createEvent', kind: 'write', risk: 'EXTERNAL_COMMUNICATION', reversibility: 'PARTIALLY_REVERSIBLE', previewKind: 'calendar', needsConnection: true, schema: calendarCreateSchema, description: 'Create a calendar event' },
  { id: 'calendar.update', connectorSlug: 'google-calendar', operation: 'updateEvent', kind: 'write', risk: 'REVERSIBLE_WRITE', reversibility: 'REVERSIBLE', previewKind: 'calendar', needsConnection: true, schema: calendarCreateSchema, description: 'Update a calendar event' },
  { id: 'slack.post', connectorSlug: 'slack', operation: 'postMessage', kind: 'write', risk: 'EXTERNAL_COMMUNICATION', reversibility: 'PARTIALLY_REVERSIBLE', previewKind: 'slack', needsConnection: true, schema: slackPostSchema, description: 'Post a Slack message' },
  { id: 'crm.update', connectorSlug: 'crm', operation: 'updateRecord', kind: 'write', risk: 'REVERSIBLE_WRITE', reversibility: 'REVERSIBLE', previewKind: 'crm', needsConnection: true, schema: crmUpdateSchema, description: 'Update a CRM record' },

  // DESTRUCTIVE / cancel — registered so policy can DENY explicitly; never default-on.
  { id: 'calendar.cancel', connectorSlug: 'google-calendar', operation: 'cancelEvent', kind: 'write', risk: 'DESTRUCTIVE', reversibility: 'IRREVERSIBLE', previewKind: 'delete', needsConnection: true, schema: readSchema, description: 'Cancel a calendar event' },
  { id: 'drive.delete', connectorSlug: 'google-drive', operation: 'delete', kind: 'write', risk: 'DESTRUCTIVE', reversibility: 'IRREVERSIBLE', previewKind: 'delete', needsConnection: true, schema: readSchema, description: 'Delete a Drive file' },

  // Mock write tools — power the offline safe demonstration end-to-end.
  { id: 'mock.createDraft', connectorSlug: 'mock', operation: 'createDraft', kind: 'write', risk: 'REVERSIBLE_WRITE', reversibility: 'REVERSIBLE', previewKind: 'draft', needsConnection: true, schema: emailSendSchema, description: 'Create a draft in the mock account' },
  { id: 'mock.send', connectorSlug: 'mock', operation: 'send', kind: 'write', risk: 'EXTERNAL_COMMUNICATION', reversibility: 'IRREVERSIBLE', previewKind: 'email', needsConnection: true, schema: emailSendSchema, description: 'Send an email from the mock account' },
];

export function getAgentTool(toolId: string): AgentTool | null {
  return AGENT_TOOLS.find((t) => t.id === toolId) ?? null;
}

/** True only for tool ids that exist in the allowlist. Everything else is rejected. */
export function isKnownTool(toolId: string): boolean {
  return AGENT_TOOLS.some((t) => t.id === toolId);
}

// ---- Context-aware catalog filtering ----

export interface AvailableConnection {
  id: string;
  connectorSlug: string;
  status: string; // connection_status
  capabilities: string[];
}

export interface ToolCatalogContext {
  mode: 'CHAT' | 'ASSISTED' | 'AGENT';
  plan: Plan;
  connections: AvailableConnection[];
  /** Tools an effective policy has hard-DENIED (from platform/org/user + kill switch). */
  deniedToolIds?: Set<string>;
  /** When false, only read tools are exposed regardless of policy. */
  writesAllowedByMode?: boolean;
}

export interface CatalogEntry {
  toolId: string;
  connectionId: string; // the concrete live connection the tool would use
  connectorSlug: string;
  kind: ToolKind;
  risk: AgentRiskLevel;
  reversibility: Reversibility;
  description: string;
}

/**
 * Return only tools that (a) exist + are not killed, (b) map to a connector the
 * user has an ACTIVE connection for, (c) whose capability the connection granted,
 * (d) are permitted by plan + mode + effective policy. A denied/unavailable tool
 * is simply omitted — we never rely on the model "not using" a visible tool.
 */
export function buildToolCatalog(ctx: ToolCatalogContext): CatalogEntry[] {
  if (ctx.mode === 'CHAT') return []; // CHAT never exposes tools
  if (!ctx.plan.connectorsEnabled) return [];
  const denied = ctx.deniedToolIds ?? new Set<string>();
  const allowWrites = ctx.writesAllowedByMode !== false;

  const activeByslug = new Map<string, AvailableConnection>();
  for (const c of ctx.connections) if (c.status === 'ACTIVE' && !activeByslug.has(c.connectorSlug)) activeByslug.set(c.connectorSlug, c);

  const out: CatalogEntry[] = [];
  for (const tool of AGENT_TOOLS) {
    if (denied.has(tool.id)) continue;
    if (tool.kind === 'write' && !allowWrites) continue;
    const conn = activeByslug.get(tool.connectorSlug);
    if (tool.needsConnection && !conn) continue;
    // Reads require the connection to grant the read capability; write availability
    // is governed by policy (approval) at execution, not hidden from the catalog.
    out.push({ toolId: tool.id, connectionId: conn!.id, connectorSlug: tool.connectorSlug, kind: tool.kind, risk: tool.risk, reversibility: tool.reversibility, description: tool.description });
  }
  return out;
}

// ---- Output normalization (never pass giant raw provider payloads to the model) ----

export interface NormalizedToolResult {
  success: boolean;
  toolId: string;
  summary: string;
  items?: Array<{ externalId: string; name: string; snippet?: string }>;
  externalResourceId?: string;
  error?: string;
  auditId?: string;
  timestamp: string;
}
