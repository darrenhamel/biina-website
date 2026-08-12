/**
 * Specialist agent profiles — CONFIGURATION ONLY. A profile carries instructions +
 * a MINIMIZED, READ-ONLY tool/source allowlist. Profiles do NOT own credentials or
 * independent permissions: a specialist gets only the tools its task needs, and
 * never a write tool. Being a "specialist" grants no additional authority.
 */

export type ResearchTool = 'web.search' | 'web.fetch' | 'rag.retrieve' | 'connected.search' | 'vision.analyze' | 'ocr.extract' | 'compare' | 'verify' | 'synthesize';

export type ResearchSourceType =
  | 'PUBLIC_WEB'
  | 'PRIMARY_OFFICIAL_SOURCE'
  | 'PRIVATE_DOCUMENT'
  | 'KNOWLEDGE_BASE'
  | 'CONNECTED_EMAIL'
  | 'CONNECTED_FILE'
  | 'CONNECTED_MESSAGE'
  | 'CONNECTED_RECORD'
  | 'MULTIMODAL_SOURCE';

export interface SpecialistProfile {
  id: string;
  name: string;
  specialization: string;
  /** READ-ONLY tools only. There is intentionally NO write tool in any profile. */
  allowedTools: ResearchTool[];
  allowedSourceTypes: ResearchSourceType[];
  maxSteps: number;
  maxSources: number;
}

export const SPECIALIST_PROFILES: SpecialistProfile[] = [
  { id: 'web-researcher', name: 'Web Researcher', specialization: 'Public web + primary sources', allowedTools: ['web.search', 'web.fetch'], allowedSourceTypes: ['PUBLIC_WEB', 'PRIMARY_OFFICIAL_SOURCE'], maxSteps: 4, maxSources: 8 },
  { id: 'internal-knowledge-analyst', name: 'Internal Knowledge Analyst', specialization: 'Authorized knowledge bases', allowedTools: ['rag.retrieve'], allowedSourceTypes: ['KNOWLEDGE_BASE', 'PRIVATE_DOCUMENT'], maxSteps: 4, maxSources: 8 },
  { id: 'document-analyst', name: 'Document Analyst', specialization: 'Uploaded documents (sections + citations)', allowedTools: ['rag.retrieve', 'ocr.extract'], allowedSourceTypes: ['PRIVATE_DOCUMENT', 'MULTIMODAL_SOURCE'], maxSteps: 4, maxSources: 8 },
  { id: 'connected-data-analyst', name: 'Connected Data Analyst', specialization: 'Authorized connected apps', allowedTools: ['connected.search'], allowedSourceTypes: ['CONNECTED_EMAIL', 'CONNECTED_FILE', 'CONNECTED_MESSAGE', 'CONNECTED_RECORD'], maxSteps: 3, maxSources: 6 },
  { id: 'comparison-analyst', name: 'Comparison Analyst', specialization: 'Compare collected evidence', allowedTools: ['compare'], allowedSourceTypes: [], maxSteps: 2, maxSources: 0 },
  { id: 'fact-checker', name: 'Fact Checker', specialization: 'Verify claims against evidence', allowedTools: ['verify', 'web.search'], allowedSourceTypes: ['PUBLIC_WEB', 'PRIMARY_OFFICIAL_SOURCE'], maxSteps: 3, maxSources: 4 },
  { id: 'synthesis-analyst', name: 'Synthesis Analyst', specialization: 'Synthesize verified findings', allowedTools: ['synthesize'], allowedSourceTypes: [], maxSteps: 2, maxSources: 0 },
];

export function getProfile(id: string): SpecialistProfile | null {
  return SPECIALIST_PROFILES.find((p) => p.id === id) ?? null;
}

/** A profile may NEVER carry a write/side-effecting tool. Enforced structurally. */
export function profileIsReadOnly(p: SpecialistProfile): boolean {
  return p.allowedTools.every((t) => !/send|create|update|delete|post|write|email/i.test(t));
}
