import { z } from 'zod';
import type { ProductCapability } from '@/config/experience-profiles';

/**
 * Library item TYPES + their validated configuration schemas.
 *
 * A library item is DATA + validated configuration — never executable code. Each
 * item type has a strict Zod schema; anything that does not match (arbitrary code,
 * unknown executable structures, raw URLs/endpoints) is rejected before storage.
 * Typed input fields are declarative — there is no expression/code evaluation.
 */

export type LibraryItemType = 'PROMPT_TEMPLATE' | 'AGENT_TEMPLATE' | 'WORKFLOW_TEMPLATE' | 'RESEARCH_TEMPLATE' | 'KNOWLEDGE_TEMPLATE';
export type RiskLevel = 'CONTENT_ONLY' | 'READ_ONLY' | 'WRITE_CAPABLE' | 'SCHEDULED_WRITE' | 'HIGH_RISK';

/** Ordered risk severity for comparisons (higher = more dangerous). */
export const RISK_ORDER: Record<RiskLevel, number> = {
  CONTENT_ONLY: 0,
  READ_ONLY: 1,
  WRITE_CAPABLE: 2,
  SCHEDULED_WRITE: 3,
  HIGH_RISK: 4,
};

/** Product capabilities an item may require (validated against this list). */
export const PRODUCT_CAPABILITIES: ProductCapability[] = ['chat', 'knowledge', 'files', 'web', 'research', 'agents', 'automations', 'connectors', 'vision', 'voice', 'memory', 'library', 'publicLibrary'];

// ---- Typed input fields (declarative only — no code expressions) ----

const inputFieldSchema = z
  .object({
    key: z.string().trim().min(1).max(48).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'key must be alphanumeric'),
    labelEn: z.string().trim().min(1).max(120),
    labelAr: z.string().trim().max(120).optional(),
    type: z.enum(['text', 'number', 'date', 'select', 'multiselect']),
    required: z.boolean().optional().default(false),
    // Only present for select/multiselect. Static option lists — never dynamic code.
    options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    maxLength: z.number().int().min(1).max(20_000).optional(),
  })
  .strict();

export type InputField = z.infer<typeof inputFieldSchema>;

// ---- Per-type configuration schemas ----

/** A reusable prompt with typed inputs. Pure content — cannot use tools. */
export const promptTemplateSchema = z
  .object({
    promptTemplate: z.string().trim().min(1).max(20_000),
    inputFields: z.array(inputFieldSchema).max(20).default([]),
    recommendedModelProfile: z.string().trim().max(64).optional(),
    supportedPersonas: z.array(z.string().trim().max(32)).max(10).optional(),
    outputFormat: z.enum(['text', 'markdown', 'json']).optional(),
  })
  .strict();

/** An installable assistant. Tools/connectors are declared; install grants nothing. */
export const agentTemplateSchema = z
  .object({
    instructions: z.string().trim().min(1).max(20_000),
    allowedTools: z.array(z.string().trim().min(1).max(64)).max(24).default([]),
    allowedConnectors: z.array(z.string().trim().min(1).max(48)).max(12).default([]),
    defaultModelProfile: z.string().trim().max(64).optional(),
    maxSteps: z.number().int().min(1).max(24).optional(),
    maxToolCalls: z.number().int().min(1).max(48).optional(),
    approvalPolicy: z.enum(['ASK_EVERY_WRITE', 'ASK_HIGH_RISK_ONLY', 'READ_ONLY_AUTOMATIC']).optional(),
    inputFields: z.array(inputFieldSchema).max(20).default([]),
  })
  .strict();

/** An installable automation. Ships NO credentials/schedule/standing-auth. */
export const workflowTemplateSchema = z
  .object({
    goal: z.string().trim().min(1).max(20_000),
    agentInstructions: z.string().trim().max(20_000).optional(),
    allowedTools: z.array(z.string().trim().min(1).max(64)).max(24).default([]),
    requiredConnectors: z.array(z.string().trim().min(1).max(48)).max(12).default([]),
    // A SUGGESTED trigger shape only — the installer must configure real schedule/tz.
    suggestedTrigger: z
      .object({ type: z.enum(['MANUAL', 'SCHEDULE', 'CONDITION']), pattern: z.enum(['daily', 'weekly', 'monthly', 'once']).optional() })
      .strict()
      .optional(),
    approvalPolicy: z.enum(['ASK_EVERY_WRITE', 'ASK_HIGH_RISK_ONLY', 'READ_ONLY_AUTOMATIC']).optional(),
    webSearchEnabled: z.boolean().optional(),
    inputFields: z.array(inputFieldSchema).max(20).default([]),
    defaultModelProfile: z.string().trim().max(64).optional(),
  })
  .strict();

/** A research plan preset that configures the ResearchOrchestrator structure/limits. */
export const researchTemplateSchema = z
  .object({
    objective: z.string().trim().min(1).max(4_000),
    depth: z.enum(['QUICK', 'STANDARD', 'DEEP']),
    webEnabled: z.boolean().optional(),
    inputFields: z.array(inputFieldSchema).max(20).default([]),
    supportedPersonas: z.array(z.string().trim().max(32)).max(10).optional(),
  })
  .strict();

/** Readiness: a knowledge template is metadata only in Phase 16 (no execution). */
export const knowledgeTemplateSchema = z
  .object({
    summary: z.string().trim().min(1).max(4_000),
    suggestedStructure: z.array(z.string().trim().max(200)).max(50).default([]),
  })
  .strict();

export const DEFINITION_SCHEMAS: Record<LibraryItemType, z.ZodTypeAny> = {
  PROMPT_TEMPLATE: promptTemplateSchema,
  AGENT_TEMPLATE: agentTemplateSchema,
  WORKFLOW_TEMPLATE: workflowTemplateSchema,
  RESEARCH_TEMPLATE: researchTemplateSchema,
  KNOWLEDGE_TEMPLATE: knowledgeTemplateSchema,
};

export type PromptTemplateDefinition = z.infer<typeof promptTemplateSchema>;
export type AgentTemplateDefinition = z.infer<typeof agentTemplateSchema>;
export type WorkflowTemplateDefinition = z.infer<typeof workflowTemplateSchema>;
export type ResearchTemplateDefinition = z.infer<typeof researchTemplateSchema>;

/** The definition-type stored on an installation (what local object it created). */
export type InstalledDefinitionType = 'AGENT' | 'WORKFLOW' | 'PROMPT' | 'RESEARCH' | 'KNOWLEDGE';

export function installedTypeFor(itemType: LibraryItemType): InstalledDefinitionType {
  switch (itemType) {
    case 'AGENT_TEMPLATE':
      return 'AGENT';
    case 'WORKFLOW_TEMPLATE':
      return 'WORKFLOW';
    case 'PROMPT_TEMPLATE':
      return 'PROMPT';
    case 'RESEARCH_TEMPLATE':
      return 'RESEARCH';
    case 'KNOWLEDGE_TEMPLATE':
      return 'KNOWLEDGE';
  }
}

/** Item types that create an EXECUTABLE local definition (need DRAFT + stronger review). */
export function isExecutableType(itemType: LibraryItemType): boolean {
  return itemType === 'AGENT_TEMPLATE' || itemType === 'WORKFLOW_TEMPLATE';
}
