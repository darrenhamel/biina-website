import { resolveModel } from '@biina/ai-gateway';

/**
 * Optional provider fallback — DISABLED by default.
 *
 * Rules (see docs/ARCHITECTURE.md):
 *  - Requires explicit admin configuration: AI_FALLBACK_ENABLED=true AND a
 *    configured AI_FALLBACK_MODEL. Never silent.
 *  - Never loops: the fallback provider must differ from the primary; only a
 *    single fallback attempt is ever made (enforced by the caller).
 *  - Only engages BEFORE any token has streamed (enforced by the caller), so it
 *    never causes duplicate generation / duplicate usage cost.
 *  - Failover events are logged.
 *
 * Do NOT configure a paid provider as fallback without intent — this module does
 * not special-case any vendor; it just resolves whatever the admin set.
 */

export interface FallbackPlan {
  /** Logical model id to fall back to. */
  model: string;
  /** Provider that serves that model (derived from the registry). */
  provider: string;
}

export function resolveFallbackPlan(primaryProvider: string): FallbackPlan | null {
  if (process.env.AI_FALLBACK_ENABLED !== 'true') return null;

  const model = process.env.AI_FALLBACK_MODEL?.trim();
  if (!model) return null;

  let provider: string;
  try {
    provider = resolveModel(model).provider;
  } catch {
    return null; // fallback model not in the registry / not enabled
  }

  // If an explicit provider is declared, it must match the model's provider.
  const declared = process.env.AI_FALLBACK_PROVIDER?.trim();
  if (declared && declared !== provider) return null;

  // Never fall back to the same provider that just failed (avoids loops).
  if (provider === primaryProvider) return null;

  return { model, provider };
}
