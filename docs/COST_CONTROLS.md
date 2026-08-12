# BIINA.ai — Cost Controls

Internal cost estimation and platform budget controls. All costs are **internal
estimates** and are **never shown to normal users**.

---

## Cost model

Per-model (admin-editable) metadata: `inputCostPerMillion`,
`outputCostPerMillion` (per 1M tokens), `fixedRequestCost`, `costCurrency`,
`costClass` (VERY_LOW → PREMIUM for GPU/self-hosted where per-token is unknown),
`costSource`, `costUpdatedAt`. Providers and models also carry an optional
`monthlyBudget` (readiness).

## Cost calculation service (pure)

`server/ai/cost.ts` `estimateCost(modelCost, { inputTokens, outputTokens })`:

- **token** pricing when per-million rates exist → input/output/total.
- **fixed** when only a fixed request cost exists.
- **class** when only a qualitative class exists (no numeric estimate).
- **none** otherwise.

It **never invents token counts** — missing tokens ⇒ null cost. The gateway
produces usage metadata; this service interprets it. Cost is authoritative only
insofar as the provider's token counts are.

## Budget controls (platform-wide)

Stored on `ai_settings` (admin-editable, Admin → Usage & Cost):
`dailyCostWarn` · `dailyCostHardLimit` · `monthlyCostWarn` ·
`monthlyCostHardLimit` · `hardLimitEnabled` · `currency`.

`server/ai/budget.ts` `evaluateBudget(spend, thresholds)` → status:

| Status | Meaning |
|---|---|
| `normal` | below all thresholds |
| `warning` | at/over a soft warn threshold |
| `critical` | at/over a hard limit **but enforcement is OFF** |
| `hard` | at/over a hard limit **with enforcement ON** → blocked |

### Soft alerts

When a soft threshold is reached the admin dashboard shows a warning banner and
the event is logged. Soft thresholds never block. Users never see budget state.

### Hard limit

`hardLimitEnabled=true` + spend ≥ a hard limit ⇒ new **billable** AI requests are
refused with a generic "temporarily unavailable" (503) message. Verified: the
**admin control plane stays reachable** so admins can raise/disable the limit;
in-flight streams are not force-killed.

## Admin visibility (Admin → Usage & Cost)

- **Summary**: requests/tokens/estimated-cost today & this month, active users,
  failed requests, fallback requests.
- **Budget**: status, spend today/month, editable thresholds + enforce toggle.
- **Breakdowns**: cost by provider, model, plan, workload, persona.
- **Top users**: email · plan · requests · tokens · cost (no conversation content).
- **Model economics**: per model — requests, avg TTFT, avg latency, tokens, cost,
  cost/request, failure rate — to judge which models are commercially viable.

## Readiness (not built yet)

Provider-specific budgets (`ai_providers.monthlyBudget`), model-specific ceilings
(`ai_models.monthlyBudget`), plan-level infrastructure-cost rollups, and an
internal→credits conversion layer are supported by the schema/architecture; the
enforcement/UI arrive later. **No payments, wallets, or purchased credits yet.**

## Privacy & safety

Estimated cost and infra model names are admin-only. Consumer surfaces show only
BIINA-branded usage. No dashboard exposes prompt/response text.
