# BIINA.ai — Research Costs & Entitlements

How advanced research is **metered, budgeted, and entitled**. Research is BIINA's most
resource-intensive mode — many agents, many retrievals, a deadline — so its cost
controls are layered: hard platform ceilings, per-plan entitlements, per-run budgets,
and a stop-and-synthesize rule when a budget is reached. Code:
`apps/web/src/server/research/quotas.ts`, `config.ts`, `sessions.ts`, `admin.ts`.
Companion: [`RESEARCH_SECURITY.md`](./RESEARCH_SECURITY.md),
[`USAGE_METERING.md`](./USAGE_METERING.md), [`COST_CONTROLS.md`](./COST_CONTROLS.md).

## What research consumes

A run consumes **agent runs** (each launched specialist), **sources** (each stored piece
of evidence), **wall-clock time** (a deadline), and the **model/retrieval work** behind
them. The session tracks live counters: `tasksCreated`, `tasksCompleted`,
`sourcesCollected`, `agentRunsUsed`, and `estimatedCost`.

## Cost accounting

`estimatedCost` accumulates on the session as work runs (`bumpUsage`). Costs originate
across dimensions — **model** tokens for planning/verification/synthesis, **web**
search/fetch, **connector** retrieval, and **multimodal** (OCR) work — each already
metered by its own Phase 5 / 9 / 10 / 14 ledger. Research does **not double-count**:
the lower-level usage records remain the source of truth for each dimension, and the
research session's `estimatedCost` is a roll-up for the run, not a second charge for the
same underlying token/search/page. A per-unit research cost service that fully populates
`estimatedCost` from live provider rates is **readiness**; the counters, budget, and
ceiling enforcement ship.

## Plan entitlements

Product policy lives in the plan columns (schema `plans`, Phase 15), not in env:

- `advancedResearchEnabled` — the master per-plan gate (default `false`).
- `deepResearchEnabled` — allow `DEEP` depth (default `false`).
- `researchRunsPerMonth` — monthly run quota (`null` = unlimited).
- `maxResearchTasks` — cap on tasks per run.
- `maxSourcesPerResearch` — cap on sources per run.
- `maxParallelAgents` — cap on concurrent specialists.
- `maxResearchCost` — a per-run cost ceiling (`null` = none).

`assertResearchQuota` (`quotas.ts`) runs **before** planning: it rejects with
`NOT_ENTITLED` (403) when `advancedResearchEnabled` is false or when `DEEP` is requested
without `deepResearchEnabled`, and with `QUOTA_EXCEEDED` (429) when the current UTC
month's run count for the user has reached `researchRunsPerMonth`.

## Effective limits — always the most restrictive

`resolveLimits(plan, depth)` computes the run's effective budget as the **minimum** of
the depth budget, the plan entitlement, and (via `depthBudget`) the hard platform
ceilings:

```
effective.maxTasks         = min(depth.maxTasks, plan.maxResearchTasks, RESEARCH_MAX_TASKS)
effective.maxSources       = min(depth.maxSources, plan.maxSourcesPerResearch, RESEARCH_MAX_SOURCES)
effective.maxParallelAgents= min(depth.maxParallelAgents, plan.maxParallelAgents, RESEARCH_MAX_PARALLEL_AGENTS)
effective.maxAgentRuns     = min(depth.maxAgentRuns, RESEARCH_MAX_TOTAL_AGENT_RUNS)
effective.maxDurationMs    = min(depth.maxDurationMs, RESEARCH_MAX_RUNTIME_MS)
effective.maxCost          = plan.maxResearchCost   (null = none)
```

A requested value alone never sets the limit — nothing a model or a source asks for can
raise it. Depth budgets: QUICK (2 tasks / 3 runs / 6 sources / 2 parallel / 90 s),
STANDARD (4 / 6 / 16 / 3 / 180 s), DEEP (6 / 10 / 30 / 3 / 240 s).

## Org quotas & concurrency

An org run is bound to that org's active workspace and its plan entitlements; the same
`resolveLimits` / `assertResearchQuota` gates apply. Concurrency **within a run** is
bounded by `maxParallelAgents`; platform-wide concurrency is bounded by the runtime
model (Phase 15 runs synchronously in the request that starts or `/run`s the session —
a background worker pool for many concurrent long runs is readiness). See
[`ADVANCED_RESEARCH.md`](./ADVANCED_RESEARCH.md).

## Budget stop → partial, not overspend

When any budget is reached mid-run — agent runs, sources, or the deadline — the
orchestrator **stops launching** specialists, runs verification + synthesis on the
evidence already gathered, and marks the run `PARTIALLY_COMPLETED` with a `partial`
report (logging `research.budget_exhausted`). BIINA never blows past a ceiling to
"finish"; it returns the best evidence-backed answer within budget.

## Admin dashboard

`researchOverview` (`GET /api/admin/research`, admin-only) returns **operational
metadata only** — kill-switch state (advanced research / multi-agent / web), session
counts by status (completed / partial / failed / blocked / running), today's run count,
and averages (sources / cost / tasks) plus a recent-run list (objective truncated). It
**never** exposes private source content or evidence text. See
[`RESEARCH_SECURITY.md`](./RESEARCH_SECURITY.md).
