# BIINA.ai — Cost Control Runbook

Responding to cost/spend incidents across AI, search, agents, research, and
workflows. Every procedure follows **detect → act → verify**. All costs are
**internal estimates**, never shown to normal users (`docs/COST_CONTROLS.md`).

On-call: `<ops-oncall>` · Cost owner: `<finance-eng-owner>`

---

## 0. Where the guard rails live (read first)

**Platform budget** (`ai_settings`, Admin → Usage & Cost):
`dailyCostWarn`, `dailyCostHardLimit`, `monthlyCostWarn`, `monthlyCostHardLimit`,
`hardLimitEnabled`, `currency`. `evaluateBudget(spend, thresholds)` →

| Status | Meaning |
|---|---|
| `normal` | below all thresholds |
| `warning` | at/over a soft warn threshold (banner + log; never blocks) |
| `critical` | at/over a hard limit but **enforcement OFF** |
| `hard` | at/over a hard limit with **enforcement ON** → new billable AI refused (503) |

When `hard`: billable AI requests get a generic "temporarily unavailable" (503);
the **admin control plane stays reachable** so you can raise/disable the limit;
**in-flight streams are not force-killed**.

**Agent hard limits** (`src/server/agent/risk.ts` + config): `AGENT_EXECUTION_ENABLED`,
`AGENT_WRITE_ACTIONS_ENABLED` (default off), `AGENT_DRY_RUN`, `AGENT_DISABLED_TOOLS`;
destructive/financial actions are `DENY` by default.

**Research hard ceilings** (`src/server/research/config.ts`, server-authoritative,
never raised by model-generated plans or source content):

| Ceiling | Env | Default |
|---|---|---|
| Parallel agents | `RESEARCH_MAX_PARALLEL_AGENTS` | 4 |
| Total agent runs | `RESEARCH_MAX_TOTAL_AGENT_RUNS` | 12 |
| Tasks | `RESEARCH_MAX_TASKS` | 8 |
| Sources | `RESEARCH_MAX_SOURCES` | 40 |
| Runtime | `RESEARCH_MAX_RUNTIME_MS` | 240000 (4 min) |
| Delegation depth | (fixed) | 1 |

Effective budget = `min(platform, plan, depth, session)`. Depth budgets
(QUICK/STANDARD/DEEP) are clamped to these ceilings.

**Workflow hard limits**: `WORKFLOW_MAX_HARD_STEPS` (20),
`WORKFLOW_MIN_CHECK_INTERVAL_MINUTES` (15), `WORKFLOW_MAX_CATCHUP_RUNS` (1).

---

## 1. AI / search spend spike

**Detect** — Admin → Usage & Cost shows spend near/over a warn threshold, or
budget status `warning`/`critical`; a soft-alert banner/log appears.

**Act**
1. Identify the driver (model, workload, user, org) from the usage breakdown.
2. Short-term throttle: route heavy workloads to a cheaper model, or set the
   expensive model to `maintenanceMode`.
3. Search-specific: if web/search calls are the driver, gate them —
   `RESEARCH_WEB_ENABLED=false` (research falls back to internal data), and check
   the search provider config (`docs/SEARCH_PROVIDER.md`, `WEB_SEARCH.md`).
4. If it keeps climbing, arm the hard limit (Section 5).

**Verify** — spend rate flattens; budget status trends toward `normal`.

---

## 2. Agent runaway (hard step / cost limits)

**Detect** — a single agent run consuming excessive steps/tokens; repeated
long/expensive runs.

**Act**
1. `AGENT_DRY_RUN=true` to force plan/preview/reads only (no external writes) while
   you investigate.
2. Disable a culprit tool: `AGENT_DISABLED_TOOLS="<tool.id>"`.
3. Full stop: `AGENT_EXECUTION_ENABLED=false` (no new agent runs).
4. Confirm write gating: `AGENT_WRITE_ACTIONS_ENABLED` should be unset/false unless
   deliberately enabled; destructive/financial actions are `DENY` regardless.
5. Restart the web/API tier to apply env changes.

**Verify** — runaway runs stop or are bounded; step counts within
`WORKFLOW_MAX_HARD_STEPS`/agent limits; spend rate drops.

---

## 3. Research runaway (hard agent / source / time limits)

**Detect** — research sessions spawning many agents/sources or running long.

**Act**
1. The platform ceilings already clamp any single session (Section 0). To tighten
   globally, lower `RESEARCH_MAX_PARALLEL_AGENTS`, `RESEARCH_MAX_TOTAL_AGENT_RUNS`,
   `RESEARCH_MAX_SOURCES`, or `RESEARCH_MAX_RUNTIME_MS` and restart.
2. Reduce fan-out: `MULTI_AGENT_RESEARCH_ENABLED=false` (falls to a single
   sequential agent).
3. Cut external cost: `RESEARCH_WEB_ENABLED=false`.
4. Emergency: `ADVANCED_RESEARCH_ENABLED=false`.

**Verify** — new research sessions respect the tightened ceilings; no session
exceeds the runtime/source caps.

---

## 4. Provider billing anomaly

**Detect** — provider invoice/console spend diverges from BIINA's internal
estimate.

**Act**
1. Remember internal cost is an **estimate** derived from provider-reported token
   counts (`server/ai/cost.ts` never invents tokens). Divergence can be estimate
   drift, not a bug.
2. Reconcile: compare provider console usage vs Admin usage for the window; check
   for a mispriced model (`inputCostPerMillion`/`outputCostPerMillion`/`costClass`
   stale) and update the model cost metadata.
3. If real spend is genuinely surging, treat as Section 1 + arm the hard limit.

**Verify** — model cost metadata corrected; estimates track the provider more
closely going forward.

---

## 5. Platform hard-budget switch (the big red button)

**Detect** — spend must be capped now.

**Act**
1. Admin → Usage & Cost: set `hardLimitEnabled=true` and a `dailyCostHardLimit`
   and/or `monthlyCostHardLimit` at/below current spend.
2. New **billable** AI requests are refused with a generic 503. Non-billable paths
   and the **admin control plane remain reachable**; in-flight streams finish.
3. Layer automation stops if needed: `AGENT_EXECUTION_ENABLED=false`,
   `WORKFLOWS_ENABLED=false`, `ADVANCED_RESEARCH_ENABLED=false`.

**Verify** — budget status shows `hard`; a test chat returns 503; Admin still
loads. To restore, raise the limit or set `hardLimitEnabled=false`.

---

## Do-not-do
- Never expose internal cost estimates to normal users.
- Never let a model-generated plan or source content raise a hard ceiling — those
  are server-authoritative.
- Never disable the admin control plane to save cost — you need it to lift the cap.
