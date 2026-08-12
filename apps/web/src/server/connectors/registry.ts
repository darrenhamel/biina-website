import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { connectorDefinitions } from '@/server/db/schema';
import type { ConnectorDefinition } from '@/server/db/schema';

/**
 * Connector registry vocabulary + DB accessors. Definitions carry SAFE metadata
 * only (never secrets). BIINA controls the connector catalog in Phase 10 (no
 * third-party marketplace).
 */

export const CAPABILITIES = ['SEARCH', 'LIST', 'READ', 'DOWNLOAD', 'CREATE', 'UPDATE', 'DELETE', 'SEND', 'COMMENT', 'SHARE', 'SCHEDULE'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** READ capabilities have no external side effect. WRITE ones do. */
export const READ_CAPABILITIES: Capability[] = ['SEARCH', 'LIST', 'READ', 'DOWNLOAD'];
export const WRITE_CAPABILITIES: Capability[] = ['CREATE', 'UPDATE', 'DELETE', 'SEND', 'COMMENT', 'SHARE', 'SCHEDULE'];
export const isReadCapability = (c: Capability): boolean => READ_CAPABILITIES.includes(c);

export const CATEGORIES = ['Productivity', 'Email', 'Calendar', 'File Storage', 'Communication', 'CRM', 'Knowledge', 'Project Management', 'Developer Tools', 'Other'] as const;

/** Action risk classification (used by ToolExecutionService + future agents). */
export type RiskLevel = 'READ' | 'LOW_RISK_WRITE' | 'HIGH_RISK_WRITE' | 'DESTRUCTIVE';

export interface ToolDefinition {
  id: string; // e.g. 'drive.search'
  connectorSlug: string;
  operation: string; // adapter operation
  capability: Capability;
  risk: RiskLevel;
  /** Write tools stay disabled by default in Phase 10 (no autonomous side effects). */
  enabledByDefault: boolean;
  description: string;
}

/** The internal tool ALLOWLIST — only these may ever execute. No arbitrary HTTP/API. */
export const TOOL_ALLOWLIST: ToolDefinition[] = [
  { id: 'mock.search', connectorSlug: 'mock', operation: 'search', capability: 'SEARCH', risk: 'READ', enabledByDefault: true, description: 'Search the mock connector' },
  { id: 'mock.read', connectorSlug: 'mock', operation: 'read', capability: 'READ', risk: 'READ', enabledByDefault: true, description: 'Read a mock resource' },
  { id: 'drive.search', connectorSlug: 'google-drive', operation: 'search', capability: 'SEARCH', risk: 'READ', enabledByDefault: true, description: 'Search Google Drive files' },
  { id: 'drive.read', connectorSlug: 'google-drive', operation: 'read', capability: 'READ', risk: 'READ', enabledByDefault: true, description: 'Read a Google Drive file' },
  { id: 'gmail.search', connectorSlug: 'gmail', operation: 'search', capability: 'SEARCH', risk: 'READ', enabledByDefault: true, description: 'Search Gmail messages' },
  { id: 'gmail.read', connectorSlug: 'gmail', operation: 'read', capability: 'READ', risk: 'READ', enabledByDefault: true, description: 'Read a Gmail message' },
  { id: 'calendar.list', connectorSlug: 'google-calendar', operation: 'search', capability: 'LIST', risk: 'READ', enabledByDefault: true, description: 'List calendar events' },
  { id: 'slack.search', connectorSlug: 'slack', operation: 'search', capability: 'SEARCH', risk: 'READ', enabledByDefault: true, description: 'Search Slack messages' },
  // WRITE tools are REGISTERED but DISABLED by default — no autonomous side effects.
  { id: 'gmail.send', connectorSlug: 'gmail', operation: 'send', capability: 'SEND', risk: 'HIGH_RISK_WRITE', enabledByDefault: false, description: 'Send a Gmail message' },
  { id: 'calendar.create', connectorSlug: 'google-calendar', operation: 'create', capability: 'CREATE', risk: 'LOW_RISK_WRITE', enabledByDefault: false, description: 'Create a calendar event' },
  { id: 'drive.delete', connectorSlug: 'google-drive', operation: 'delete', capability: 'DELETE', risk: 'DESTRUCTIVE', enabledByDefault: false, description: 'Delete a Drive file' },
];

export function getTool(toolId: string): ToolDefinition | null {
  return TOOL_ALLOWLIST.find((t) => t.id === toolId) ?? null;
}

/** A write tool is enabled only if the env flag AND the tool opt-in are set. */
export function writeToolsEnabled(): boolean {
  return process.env.CONNECTOR_WRITE_ACTIONS_ENABLED === 'true';
}

export async function listConnectorDefinitions(): Promise<ConnectorDefinition[]> {
  return getDb().select().from(connectorDefinitions).orderBy(connectorDefinitions.displayName);
}

export async function getConnectorDefinition(slug: string): Promise<ConnectorDefinition | null> {
  const [row] = await getDb().select().from(connectorDefinitions).where(eq(connectorDefinitions.slug, slug)).limit(1);
  return row ?? null;
}
