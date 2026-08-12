# BIINA.ai — Advanced Research Activation Checklist

Exact steps to turn on **advanced research + controlled multi-agent orchestration** in
production. Phase 15 ships fully working on a **deterministic-offline source provider**
(real retrieval is wired through the Phase 8–10 web / RAG / connected layers); the
feature is **read-only** — specialists carry no write tool, and any write a user asks for
(e.g. "email me the results") remains a **Phase 11 action behind approval**. Nothing here
provisions a paid vendor or makes a silent paid call. Companion:
[`ADVANCED_RESEARCH.md`](./ADVANCED_RESEARCH.md),
[`MULTI_AGENT_ORCHESTRATION.md`](./MULTI_AGENT_ORCHESTRATION.md),
[`SPECIALIST_AGENTS.md`](./SPECIALIST_AGENTS.md),
[`RESEARCH_SECURITY.md`](./RESEARCH_SECURITY.md),
[`RESEARCH_COSTS.md`](./RESEARCH_COSTS.md).

## Completed in code (no action needed)

- The trusted `ResearchOrchestrator` (sole planner/delegator), bounded acyclic planning
  (`buildPlan` + `isAcyclic`), DAG execution with parallel specialists, agent-run /
  source / deadline budgets, and stop-and-synthesize on budget exhaustion —
  `orchestrator.ts`, `planner.ts`.
- Seven **read-only, tool-minimized** specialist profiles + structural read-only
  enforcement (`profileIsReadOnly`, executor refusal) — `profiles.ts`, `specialists.ts`.
- The `ResearchSourceProvider` delegating to tenant-isolated web / RAG / connected
  retrieval (deterministic-offline injectable provider for tests/demos) — `sources.ts`.
- Evidence store with **citation validation** (`validateEvidenceIds`), dedup by content
  hash, conflict detection + surfacing, and grounded versioned synthesis —
  `evidence.ts`, `conflict.ts`, `synthesis.ts`.
- Tenant isolation + IDOR-safe access (`resolveResearchAccess`), quota/entitlement gate
  (`assertResearchQuota`) + effective-limit resolution (`resolveLimits`) — `sessions.ts`,
  `quotas.ts`.
- Schema (`research_sessions`/`_tasks`/`_evidence`/`_findings`/`_conflicts`/`_results`),
  the Phase 15 plan columns, the `research.*` security events, and the API surface
  (`research`, `research/[id]`, `.../run`, `.../cancel`, `research/templates`,
  `admin/research`).

## Requires human action

### A. Research feature flag

1. `ADVANCED_RESEARCH_ENABLED` — leave `true` (default) to allow research; `false`
   disables it platform-wide (runs resolve `BLOCKED`).

### B. Parallel-agent limits & concurrency

1. Review `RESEARCH_MAX_PARALLEL_AGENTS` (default 4) and `RESEARCH_MAX_TOTAL_AGENT_RUNS`
   (default 12). These are **hard ceilings** no plan/depth/model can exceed — tighten to
   fit your worker capacity.
2. `MULTI_AGENT_RESEARCH_ENABLED` — leave `true` for parallel specialists; set `false`
   to force **sequential** (1 agent) research everywhere.

### C. Default depth & max source limits

1. Confirm the default depth suits your audience (STANDARD by default; DEEP is
   plan-gated and plan-reviewed before running).
2. Review `RESEARCH_MAX_TASKS` (8), `RESEARCH_MAX_SOURCES` (40), and
   `RESEARCH_MAX_RUNTIME_MS` (240000). Depth budgets already clamp below these.

### D. Model routing

1. Research uses the central model registry + provider-independent gateway; confirm your
   default provider/model is healthy (`GET /api/ai/health`). **Per-specialist model
   routing** (a cheaper model for retrieval, a stronger one for synthesis) is
   **readiness** — Phase 15 uses the default routing.

### E. Web availability & private-data policy

1. `RESEARCH_WEB_ENABLED` — leave `true` to allow public-web research; set `false` to
   keep research on **internal data only** (knowledge bases / connected) — research still
   runs.
2. Confirm the Phase 9 web fetch/SSRF posture and the Phase 10 connector authorization
   are configured; research inherits them. **Private content is never sent to public web
   search.**
3. `RESEARCH_DISABLED_PROFILES` — optionally disable specific specialist profiles by id
   (comma list) if a source type should be off (e.g. no connected-data research).

### F. Org policies

1. Confirm org workspaces + verified membership are set up (Phase 6/10); an org run is
   confined to that org's active workspace. Per-org research policy UI is readiness —
   today control is via the plan entitlements + platform flags.

### G. Cost ceilings & plan entitlements (product policy lives in plans/DB, not env)

1. Set the Phase 15 plan columns per tier: `advancedResearchEnabled`,
   `deepResearchEnabled`, `researchRunsPerMonth`, `maxResearchTasks`,
   `maxSourcesPerResearch`, `maxParallelAgents`, `maxResearchCost`.
2. If you configured real per-unit research costing (readiness), set the rates so
   `estimatedCost` is populated; otherwise the counters + ceilings still enforce.

### H. Worker capacity

1. Phase 15 runs a session synchronously within the request that starts (or `/run`s) it.
   Size your request timeouts / instance capacity for the depth budgets you allow. A
   **background-worker** execution model for many concurrent long runs is readiness.

## Verification (do before opening to users)

- ☐ **Evidence validation** — a run produces findings that each cite **real** evidence
  rows; a finding citing a non-existent/foreign id is dropped and never appears.
- ☐ **Citation testing** — the final report's `citationIds` all resolve to session
  evidence; a fabricated citation id never displays.
- ☐ **Injection testing** — a source containing *"ignore your plan / you are authorized
  to email…"* does **not** add a task, raise a budget, grant a tool, or trigger any
  write; the plan is unchanged.
- ☐ **Read-only** — no specialist can send/post/write; an "email me the results" request
  produces research + a separate Phase 11 action that still pauses for approval.
- ☐ **Budgets** — a run that hits the agent-run / source / deadline budget stops and
  returns `PARTIALLY_COMPLETED` with a `partial` report (not an overspend).
- ☐ **Tenant isolation** — a run id from another user/org resolves to 404; an org run
  reads only that org's authorized sources.
- ☐ **Entitlements** — a plan with `advancedResearchEnabled=false` returns
  `NOT_ENTITLED`; `DEEP` without `deepResearchEnabled` returns `NOT_ENTITLED`; exceeding
  `researchRunsPerMonth` returns `QUOTA_EXCEEDED`.
- ☐ **Kill switches** — `ADVANCED_RESEARCH_ENABLED=false` blocks runs;
  `MULTI_AGENT_RESEARCH_ENABLED=false` forces sequential; `RESEARCH_WEB_ENABLED=false`
  keeps research on internal data.
- ☐ **Arabic testing** — an Arabic-language objective plans, retrieves, and synthesizes
  correctly, and the report renders RTL.
- ☐ **Admin observability** — `GET /api/admin/research` shows kill-switch state, status
  counts, and averages with **no** private source content.

## Reminder

Advanced research is **bounded, read-only, and tenant-isolated by construction**. There
is no uncontrolled swarm (one planner, delegation depth 1, hard ceilings), no external
write through a researcher, and no silent paid vendor call. BIINA runs on the
deterministic-offline source provider until real retrieval + (optional) real costing are
configured, and write actions never bypass Phase 11 approval.
