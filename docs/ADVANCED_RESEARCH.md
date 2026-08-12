# BIINA.ai — Advanced Research

BIINA.ai's **advanced research** mode: give an objective, and BIINA runs a **bounded,
multi-step investigation** — it plans a small set of research tasks, dispatches
**read-only specialist agents** to gather evidence from the sources you authorized,
verifies key claims, surfaces disagreements, and synthesizes an **evidence-based
report with validated citations**. It is a **controlled orchestrator**, not an
autonomous swarm: every limit is server-authoritative and nothing a model or a source
says can widen it. Code: `apps/web/src/server/research/`. Companion docs:
[`MULTI_AGENT_ORCHESTRATION.md`](./MULTI_AGENT_ORCHESTRATION.md),
[`SPECIALIST_AGENTS.md`](./SPECIALIST_AGENTS.md),
[`RESEARCH_EVIDENCE.md`](./RESEARCH_EVIDENCE.md),
[`RESEARCH_CITATIONS.md`](./RESEARCH_CITATIONS.md),
[`RESEARCH_SECURITY.md`](./RESEARCH_SECURITY.md),
[`RESEARCH_COSTS.md`](./RESEARCH_COSTS.md),
[`ADVANCED_RESEARCH_ACTIVATION_CHECKLIST.md`](./ADVANCED_RESEARCH_ACTIVATION_CHECKLIST.md).

## Research vs Chat vs Agent

BIINA has three distinct ways of working, and research is deliberately its **own** mode:

| Mode | What it does | Writes? |
|---|---|---|
| **Chat** (Phase 1–14) | One-shot answer, optionally grounded on RAG / web / connected / media. | No. |
| **Agent** (Phase 11) | Bounded, human-supervised tool use — the model proposes, BIINA authorizes/executes/audits. | Writes pause for approval. |
| **Research** (Phase 15) | A multi-task, multi-specialist **investigation** that plans, gathers evidence, verifies, and synthesizes a cited report. | **Never** — specialists are read-only. |

Research reuses the same substrate as the agent engine — the same retrieval layers,
budgets, tenant isolation, and audit posture — but the specialists it dispatches carry
**no write tool at all**. An "email me the results" request separates the *research*
(read-only) from the *email* (a Phase 11 write that still needs approval); research
itself never sends, posts, or writes anything.

## The research lifecycle

A run moves through a fixed set of states (`research_status`):

```
PLANNING ─▶ RUNNING ─▶ SYNTHESIZING ─▶ COMPLETED
   │           │                    └▶ PARTIALLY_COMPLETED   (budget exhausted / a task failed)
   │           └▶ CANCELED           (user canceled between tasks)
   └▶ BLOCKED                        (kill switch off)
```

- **PLANNING** — the orchestrator builds a bounded, acyclic task plan from the
  objective and the source scope. The plan (`{ questions, areas }`) is **concise and
  user-facing**, not hidden reasoning.
- **RUNNING** — retrieval specialists execute in parallel up to the concurrency limit,
  respecting the task DAG and every budget.
- **SYNTHESIZING** — findings are verified against evidence, conflicts detected, and a
  versioned report produced.
- **COMPLETED** — the run finished within budget with no failed task.
- **PARTIALLY_COMPLETED** — a budget was exhausted (agent-runs / sources / deadline) or
  a task failed; BIINA **stops launching work and synthesizes whatever evidence
  exists** rather than discarding it. The report is flagged `partial`.
- **CANCELED** — the user canceled; work already gathered is retained.
- **BLOCKED** — advanced research is disabled platform-wide (`ADVANCED_RESEARCH_ENABLED=false`).

`AWAITING_APPROVAL` exists in the status enum for future approval-gated research steps;
Phase 15 does not pause a research run for approval (there is no write to approve).

## Session, plan & task model

Three persisted layers under one session (schema Phase 15, `sessions.ts`, `planner.ts`):

- **`research_sessions`** — one bounded run: objective, depth, the effective budgets
  (`maxTasks` / `maxAgentRuns` / `maxSources` / `maxParallelAgents` / `maxCost` /
  `maxDurationMs`), consumption counters (`tasksCreated` / `tasksCompleted` /
  `sourcesCollected` / `agentRunsUsed` / `estimatedCost`), the user-facing `plan`
  (`{ questions, areas }`), and the **requested source scope** (`knowledgeBaseIds`,
  `connectionIds`, `webEnabled`). A session belongs to **one workspace context**
  (personal **XOR** org) and never reads another org's data.
- **`research_tasks`** — the plan's tasks, each a node in a **DAG** (`dependsOnTaskIds`).
  A task carries a minimized, **read-only** surface — its `assignedProfile`,
  `allowedTools`, `allowedSourceTypes`, `scope`, and per-task `maxSources`. Task types:
  `WEB_RESEARCH`, `PRIVATE_KNOWLEDGE_RESEARCH`, `CONNECTED_DATA_RESEARCH`,
  `DOCUMENT_ANALYSIS`, `COMPARISON`, `VERIFICATION`, `SYNTHESIS_SUPPORT`.
- **`research_evidence` / `research_findings` / `research_conflicts` / `research_results`**
  — the gathered evidence (with provenance + quality metadata), the claim↔evidence
  findings, detected source disagreements, and the final versioned report. See
  [`RESEARCH_EVIDENCE.md`](./RESEARCH_EVIDENCE.md) and
  [`RESEARCH_CITATIONS.md`](./RESEARCH_CITATIONS.md).

## Depth levels & budgets

The requested **depth** maps to a bounded budget, which is then **clamped** to the hard
platform ceilings and the plan entitlement — the effective limit is always
`min(platform, plan, depth)`, never the requested value alone (`config.ts`, `quotas.ts`):

| Depth | maxTasks | maxAgentRuns | maxSources | maxParallel | maxDuration |
|---|---|---|---|---|---|
| **QUICK** | 2 | 3 | 6 | 2 | 90 s |
| **STANDARD** (default) | 4 | 6 | 16 | 3 | 180 s |
| **DEEP** | 6 | 10 | 30 | 3 | 240 s |

Hard platform ceilings (`config.ts`, env-overridable, model/source can **never** raise
them): `RESEARCH_MAX_PARALLEL_AGENTS=4`, `RESEARCH_MAX_TOTAL_AGENT_RUNS=12`,
`RESEARCH_MAX_TASKS=8`, `RESEARCH_MAX_SOURCES=40`, `RESEARCH_MAX_RUNTIME_MS=240000`.
When `MULTI_AGENT_RESEARCH_ENABLED=false`, parallelism is forced to **1** (research
still runs, sequentially). See [`RESEARCH_COSTS.md`](./RESEARCH_COSTS.md) for the plan
entitlement columns.

## Plan review for DEEP

`QUICK` and `STANDARD` runs **plan then auto-start**. `DEEP` runs (or any request with
`autoStart: false`) **plan and stop** in `PLANNING`, returning the questions, areas,
and task outline so a person can review before committing an expensive run — the
explicit `POST /api/research/[id]/run` starts it. Deep research is additionally gated
by `plan.deepResearchEnabled`.

## Templates

`RESEARCH_TEMPLATES` (`admin.ts`, served by `GET /api/research/templates`) are
**structure-only** starting points — an objective string with a `{placeholder}` and a
suggested depth:

- **Market Analysis** (STANDARD), **Competitor Comparison** (STANDARD),
  **Vendor Due Diligence** (DEEP), **Regulatory Research** (DEEP),
  **Executive Brief** (STANDARD).

A template only pre-fills the objective/depth; it grants no extra authority and does
not choose your source scope.

## Natural-language request

A run is started with a plain objective (`POST /api/research`, `startResearchSchema`):
`objective` (8–4000 chars), `depth`, and the **source scope** you authorize —
`knowledgeBaseIds` (≤20), `connectionIds` (≤8), `webEnabled`. The orchestrator turns
the objective into sub-questions and tasks deterministically; **source content can
never add or modify a task** — only the orchestrator plans (`planner.ts`).

## Cancellation & partial results

`POST /api/research/[id]/cancel` (manager-only) sets the session `CANCELED`. The
orchestrator checks the live session status **between task batches**, so cancellation
stops new work; evidence already gathered is retained. Likewise, when any budget is
exhausted mid-run, BIINA does not throw away progress — it stops launching specialists,
runs verification + synthesis on the evidence collected, and marks the run
`PARTIALLY_COMPLETED` with a `partial` report.

## Follow-up & resume — readiness

Sessions, tasks, evidence, findings, and results all persist, and results are
**versioned** (`research_results.version`), so BIINA is built to support follow-up
questions and re-runs on top of a completed session. A dedicated follow-up/resume flow,
background-worker execution of long runs, per-specialist model routing, multi-model
comparison, and research→knowledge-base / file export are **readiness** — the schema and
services are shaped for them, but Phase 15 runs synchronously through the request that
starts (or `/run`s) the session, on the deterministic-offline source provider.

## API surface

```
POST /api/research                 # start a run — plan-gated, quota-checked, kill-switched
                                   #   QUICK/STANDARD auto-start; DEEP plans then needs /run
GET  /api/research                 # list the caller's runs in the active scope
GET  /api/research/[id]            # full detail: plan, tasks, sources, findings, conflicts, report
POST /api/research/[id]/run        # execute a planned (e.g. reviewed DEEP) run — LIVE entitlement re-check
POST /api/research/[id]/cancel     # stop new tasks (completed evidence remains)
GET  /api/research/templates       # built-in research templates (structure only)
GET  /api/admin/research           # platform/org research overview — metadata + kill switches only
```

Every privileged fact (plan, org, role, budgets) is derived server-side from the
session, never from the request body. Access is resolved by
`resolveResearchAccess` (personal → owner; org → active org + verified member); a
foreign or wrong-tenant id resolves to **null → 404** (no existence leak). Running and
canceling additionally require `canManage` (the initiating user). See
[`RESEARCH_SECURITY.md`](./RESEARCH_SECURITY.md).
