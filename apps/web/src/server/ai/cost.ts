/**
 * UsageCostService — pure cost estimation.
 *
 * Interprets normalized usage metadata into an INTERNAL cost estimate. It never
 * invents token counts (nulls stay null) and never runs in the UI. Token prices
 * are per 1,000,000 tokens. Cost is always an ESTIMATE unless the provider's
 * token counts are authoritative.
 */

export interface ModelCost {
  inputCostPerMillion?: number | null;
  outputCostPerMillion?: number | null;
  fixedRequestCost?: number | null;
  costCurrency?: string | null;
  costClass?: string | null;
}

export interface CostEstimate {
  inputCost: number | null;
  outputCost: number | null;
  totalCost: number | null;
  currency: string;
  /** How the estimate was derived: token pricing, fixed-only, class-only, or none. */
  source: 'token' | 'fixed' | 'class' | 'none';
}

export function estimateCost(
  cost: ModelCost | undefined,
  usage: { inputTokens?: number | null; outputTokens?: number | null },
): CostEstimate {
  const currency = cost?.costCurrency || 'USD';
  if (!cost) return { inputCost: null, outputCost: null, totalCost: null, currency, source: 'none' };

  const hasTokenPricing = cost.inputCostPerMillion != null || cost.outputCostPerMillion != null;
  const fixed = cost.fixedRequestCost ?? null;

  if (hasTokenPricing) {
    const inTok = usage.inputTokens ?? null;
    const outTok = usage.outputTokens ?? null;
    const inputCost = inTok != null && cost.inputCostPerMillion != null ? (inTok / 1_000_000) * cost.inputCostPerMillion : null;
    const outputCost = outTok != null && cost.outputCostPerMillion != null ? (outTok / 1_000_000) * cost.outputCostPerMillion : null;
    const parts = [inputCost, outputCost, fixed].filter((v): v is number => v != null);
    const totalCost = parts.length > 0 ? round(parts.reduce((a, b) => a + b, 0)) : null;
    return { inputCost: nn(inputCost), outputCost: nn(outputCost), totalCost, currency, source: 'token' };
  }

  if (fixed != null) {
    return { inputCost: null, outputCost: null, totalCost: round(fixed), currency, source: 'fixed' };
  }

  // Only a qualitative class is known — no numeric estimate.
  if (cost.costClass) {
    return { inputCost: null, outputCost: null, totalCost: null, currency, source: 'class' };
  }
  return { inputCost: null, outputCost: null, totalCost: null, currency, source: 'none' };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
function nn(n: number | null): number | null {
  return n == null ? null : round(n);
}
