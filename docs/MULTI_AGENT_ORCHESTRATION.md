# BIINA.ai — Controlled Multi-Agent Orchestration

How advanced research runs **many specialist agents** without becoming an autonomous
swarm. The organizing principle is one sentence: **multi-agent does NOT mean multiple
authorities.** There is exactly **one** planner and delegator — the
`ResearchOrchestrator` — and every specialist it dispatches is a subordinate,
bounded, read-only worker. Code: `apps/web/src/server/research/orchestrator.ts`
(with `planner.ts`, `specialists.ts`, `config.ts`). Companion:
[`ADVANCED_RESEARCH.md`](./ADVANCED_RESEARCH.md),
[`SPECIALIST_AGENTS.md`](./SPECIALIST_AGENTS.md),
[`RESEARCH_SECURITY.md`](./RESEARCH_SECURITY.md).

## Multi-agent ≠ multiple authorities

Adding specialists adds **capacity**, never **authority**. A specialist is subordinate
to every layer that already governs BIINA, in order:

```
platform safety → org policy → user permissions → plan entitlement
   → research budget → tool policy → action policy (Phase 11 approvals)
```

A "specialist" is a role label over a minimized read-only toolset, not a principal with
its own permissions or credentials. It cannot escalate, cannot widen its own scope,
cannot reach a tool its task did not grant, and cannot write anywhere. See
[`SPECIALIST_AGENTS.md`](./SPECIALIST_AGENTS.md).

## The orchestrator — the only planner/delegator

`ResearchOrchestrator` is trusted server logic. It is the **sole** authority that:

1. **Plans** (`planResearch` → `buildPlan`) — turns the objective + the authorized
   source scope into a **bounded, acyclic** task plan, then validates the DAG
   (`isAcyclic`) and rejects any plan with a dependency cycle.
2. **Persists tasks** (`persistTasks`) — writes each task with resolved dependency ids,
   skipping any task whose profile is disabled by a kill switch or unknown.
3. **Runs** (`runResearch`) — executes the DAG, launches specialists in parallel up to
   the limit, enforces the agent-run / source / deadline budgets, then verifies and
   synthesizes.

Crucially, **nothing here is alterable by source content.** A web page or document a
specialist reads is untrusted data; it can never add a task, raise a budget, change a
tool grant, or redirect the plan. Only the orchestrator plans.

## Bounded delegation — depth 1, no self-creation

Delegation depth is fixed at **1** (`MAX_DELEGATION_DEPTH = 1`, `config.ts`):

```
Orchestrator ──dispatches──▶ Specialist   (depth 1 — allowed)
Specialist   ──dispatches──▶ (anything)    (NOT possible — no code path)
```

A specialist (`runSpecialistTask`) is a leaf worker: it gathers evidence and emits
findings, and that is all. It **cannot create tasks, cannot spawn or delegate to other
agents, and cannot widen scope.** There is no recursion, no nesting, no agent that
births more agents — so a "research → sub-research → sub-sub-research" explosion has no
path to exist.

## The task DAG & dependency execution

The planner emits a small DAG. A typical STANDARD plan:

```
[Public web research] ─┐
[Internal knowledge]  ─┼─▶ [Verify key claims] ─▶ [Synthesize findings]
[Connected data]      ─┘
```

- **Retrieval tasks** (web / internal / connected) have no dependencies and run first,
  in parallel.
- A **verification** task depends on all retrieval tasks (checks claims against the
  collected evidence, flags conflicts).
- A **synthesis** task depends on everything before it and always runs last.

`runResearch` only launches a task when `dependsOnTaskIds.every(done or failed)` — a
task never starts before its inputs are resolved. A failed dependency does not deadlock
the graph: the dependent still becomes eligible, operating on whatever evidence exists.

## Parallel execution & concurrency limits

Retrieval specialists run in **parallel batches** (`Promise.all`), each batch sized to
`min(maxParallelAgents, maxAgentRuns - agentRuns)`. Parallelism is bounded by:

- the **effective** `maxParallelAgents` = `min(depth, plan, RESEARCH_MAX_PARALLEL_AGENTS)`;
- forced to **1** when `MULTI_AGENT_RESEARCH_ENABLED=false` (sequential mode — research
  still completes).

The default hard ceiling is `RESEARCH_MAX_PARALLEL_AGENTS=4`; depth budgets cap it
lower (QUICK 2, STANDARD/DEEP 3).

## Agent-run ceilings & budget stop

Every launched specialist counts as one **agent run**. The loop stops launching work
the moment any budget is reached:

- **Agent runs** — `agentRuns >= maxAgentRuns` (hard ceiling `RESEARCH_MAX_TOTAL_AGENT_RUNS=12`).
- **Sources** — `sourcesUsed >= maxSources` (hard ceiling `RESEARCH_MAX_SOURCES=40`).
- **Deadline** — `Date.now() > deadline` where `deadline = start + maxDurationMs`
  (hard ceiling `RESEARCH_MAX_RUNTIME_MS=240000`).

When exhausted, `budgetExhausted` is set, the orchestrator **stops launching**, and the
pipeline still runs verification + synthesis on the evidence gathered — the run ends
`PARTIALLY_COMPLETED` with a `partial` report, logging `research.budget_exhausted`.
Between batches the orchestrator re-reads the session and aborts if it is `CANCELED`.

## Model routing per specialist — readiness

Research reuses BIINA's central model registry and provider-independent gateway, so
which model answers is infrastructure and the frontend never learns it. Routing a
**different model per specialist** (e.g. a cheaper model for retrieval, a stronger one
for synthesis) is **readiness** — the profile/task structure is shaped for it, but
Phase 15 does not yet select a distinct model per profile. A gateway fallback to
another provider mid-run changes nothing about permissions, budgets, tenant, or
approval — those live in BIINA, not the model.

## Agent-disagreement handling — verify, don't vote

When specialists surface conflicting evidence, BIINA does **not** take a majority vote
or silently pick a winner. Verification (`detectConflicts`, `conflict.ts`) compares the
collected evidence, records a `ResearchConflict`, and flags **only** the findings that
cite the conflicting evidence as `CONFLICTING`. Synthesis then surfaces the
disagreement as an explicit **uncertainty** in the report rather than manufacturing a
consensus. Authoritative/current sources are preferred only when justified, with the
disagreement still communicated. See [`RESEARCH_EVIDENCE.md`](./RESEARCH_EVIDENCE.md).

## Reuse, not a separate runtime

The `ResearchOrchestrator` deliberately **reuses** existing BIINA machinery rather than
introducing a parallel agent runtime: the Phase 8–10 tenant-isolated retrieval
(web / RAG / connected) via the `ResearchSourceProvider`, the Phase 13 ContextEngine
posture, and the same server-side budget/quota + audit patterns as the Phase 11
`AgentOrchestrator`. There is no new external-write path — specialists have none. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §4l.
