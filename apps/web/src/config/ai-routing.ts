/**
 * Routing vocabulary — capabilities, workloads, plans, personas.
 *
 * These are the STABLE keys the routing engine reasons about. The DB stores
 * assignments (persona→model, workload→model, …); this file defines the allowed
 * keys and the capability requirements per workload.
 */

/** Standardized model capabilities. Routing rejects routes that can't satisfy required ones. */
export const CAPABILITIES = [
  'chat',
  'streaming',
  'reasoning',
  'tools',
  'vision',
  'files',
  'structuredOutput',
  'longContext',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Workloads. Phase 4 implements a minimal set; the type lists future ones so the
 * architecture is ready without building them.
 */
export const WORKLOADS = ['general-chat', 'fast-chat', 'reasoning'] as const;
export type Workload = (typeof WORKLOADS)[number];

export const FUTURE_WORKLOADS = [
  'coding',
  'search',
  'translation',
  'document-analysis',
  'vision',
  'image-generation',
  'agent',
] as const;

/** Capabilities a workload REQUIRES of any model that serves it. */
export const WORKLOAD_REQUIREMENTS: Record<Workload, Capability[]> = {
  'general-chat': ['chat', 'streaming'],
  'fast-chat': ['chat', 'streaming'],
  reasoning: ['chat', 'streaming', 'reasoning'],
};

export function isWorkload(v: string): v is Workload {
  return (WORKLOADS as readonly string[]).includes(v);
}

/** Plans (mirrors the DB user_plan enum). Routing readiness only; no billing. */
export const PLANS = ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE', 'ADMIN'] as const;
export type Plan = (typeof PLANS)[number];

/** Personas that can carry a routing assignment (mirrors config/personas.ts ids). */
export const ROUTABLE_PERSONAS = [
  'default',
  'kids',
  'teens',
  'campus',
  'professional',
  'business',
  'government',
] as const;
export type RoutablePersona = (typeof ROUTABLE_PERSONAS)[number];

/**
 * Personas that must be restricted to approved models by future safety policy.
 * Phase 4 only marks the control point; the full youth-safety system is later.
 */
export const SAFETY_RESTRICTED_PERSONAS: RoutablePersona[] = ['kids', 'teens'];
