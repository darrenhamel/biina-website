import type { Plan } from '@/server/db/schema';

/**
 * Entitlement checks — pure functions over a Plan. All AI entitlement decisions
 * happen server-side; the frontend uses these only for UX. A plan with empty
 * allow-lists permits everything for that dimension (the default).
 */

export function canUseModel(plan: Plan, modelSlug: string): boolean {
  return plan.allowedModels.length === 0 || plan.allowedModels.includes(modelSlug);
}

export function canUseWorkload(plan: Plan, workload?: string | null): boolean {
  if (!workload) return true;
  return plan.allowedWorkloads.length === 0 || plan.allowedWorkloads.includes(workload);
}

export function canUsePersona(plan: Plan, persona?: string | null): boolean {
  if (!persona) return true;
  return plan.allowedPersonas.length === 0 || plan.allowedPersonas.includes(persona);
}

export function canUseFeature(plan: Plan, feature: 'files' | 'tools' | 'webSearch'): boolean {
  switch (feature) {
    case 'files':
      return plan.filesEligible;
    case 'tools':
      return plan.toolsEligible;
    case 'webSearch':
      return plan.webSearchEligible;
  }
}

/** The effective output-token cap = the smaller of the plan and model limits. */
export function effectiveMaxOutputTokens(
  plan: Plan,
  modelMaxOutputTokens?: number | null,
): number | undefined {
  const limits = [plan.maxOutputTokens, modelMaxOutputTokens].filter((v): v is number => typeof v === 'number' && v > 0);
  return limits.length ? Math.min(...limits) : undefined;
}

/** Rough, provider-agnostic token estimate for a set of messages (~4 chars/token). */
export function estimateContextTokens(messages: Array<{ content: string }>): number {
  const chars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  return Math.ceil(chars / 4);
}
