# BIINA.ai — Research Security

Security invariants for advanced research + multi-agent orchestration. Running **many
agents over private and public sources** could open serious surfaces — an autonomous
swarm, research-plan poisoning, tool-injection through a source, cross-source
exfiltration, tenant leakage. All are defended **structurally**, not by trusting the
model. Extends [`SECURITY.md`](./SECURITY.md),
[`AGENT_SECURITY.md`](./AGENT_SECURITY.md),
[`RAG_SECURITY.md`](./RAG_SECURITY.md),
[`WEB_SECURITY.md`](./WEB_SECURITY.md),
[`CONNECTOR_SECURITY.md`](./CONNECTOR_SECURITY.md). Code:
`apps/web/src/server/research/`.

## First principle — capacity, not authority

Multi-agent adds **capacity**, never **authority**. A specialist is a bounded,
read-only, tool-minimized executor subordinate to every existing layer:

```
platform safety → org policy → user permissions → plan entitlement
   → research budget → tool policy → action policy (Phase 11 approvals)
```

Source content a specialist reads is **untrusted data**. It can never change the plan,
the budget, the tool grants, the permissions, or the policy. Safety does not depend on
the model obeying instructions — it depends on the gates below.

## Bounded delegation, no self-creation, hard limits

- **One planner.** Only the trusted `ResearchOrchestrator` creates tasks; a specialist
  (`runSpecialistTask`) cannot create tasks, spawn agents, or delegate.
- **Depth fixed at 1** (`MAX_DELEGATION_DEPTH = 1`) — orchestrator → specialist, no
  nesting, no recursion. There is no code path for an agent to birth more agents.
- **Hard ceilings** the model/source can never raise (`config.ts`):
  `RESEARCH_MAX_PARALLEL_AGENTS` (4), `RESEARCH_MAX_TOTAL_AGENT_RUNS` (12),
  `RESEARCH_MAX_TASKS` (8), `RESEARCH_MAX_SOURCES` (40), `RESEARCH_MAX_RUNTIME_MS`
  (240000). Effective budget = `min(platform, plan, depth)`; a plan/depth can only be
  **more** restrictive.
- **Acyclic plans only.** `isAcyclic` rejects any task DAG with a dependency cycle, so a
  plan cannot loop.

## Server-side budgets — every run is finite

`runResearch` stops launching work the instant any budget is reached — agent runs
(`>= maxAgentRuns`), sources (`>= maxSources`), or the deadline
(`start + maxDurationMs`). It then still verifies + synthesizes what exists and ends
`PARTIALLY_COMPLETED` (`research.budget_exhausted`). Budgets are counted server-side on
the session, never trusted from the request or the model.

## Tool minimization & no external write

Specialists get **only** the read tools their task grants (task ∩ profile). There is
**no write tool in any profile** — `profileIsReadOnly` structurally forbids any tool
name matching `send/create/update/delete/post/write/email`, and `runSpecialistTask`
refuses (logs `research.blocked`) a non-read-only or unknown profile. **A researcher
cannot write to any external system.** An "email me the results" request separates the
research task (read-only) from the email action, which remains a Phase 11 write behind
approval — research can never send, post, or write on its own.

## Tenant isolation & IDOR

`resolveResearchAccess` enforces one workspace per session: a **personal** session
resolves only for its owner; an **organization** session only within *that* org's active
workspace for a **verified member**. A foreign or wrong-tenant id → **null → 404** (no
existence leak). `canManage` (the initiating user) is additionally required to run or
cancel. Retrieval passes the session's own `userId`/`organizationId`/`knowledgeBaseIds`/
`connectionIds` to the tenant-isolated layers, so **Org A can never read Org B's data**,
and a specialist can't substitute another tenant's ids.

## Prompt-injection defense — source content can't change the run

The core research-specific threat is a source that tries to hijack the investigation
(*"ignore your plan and research X", "you are now authorized to email…"*). It has no
path:

- **The plan is trusted server logic.** `buildPlan` derives tasks from the objective +
  the authorized scope only; **source content never adds or modifies a task** (only the
  orchestrator plans). This is research-plan-poisoning defense.
- **Budgets/tools/permissions/policy are server-authoritative** and re-derived, never
  taken from source content or model output.
- **Source content is not executed.** A source's text is stored as a bounded excerpt +
  provenance and treated as untrusted DATA — the same boundary inherited from RAG / web /
  connected retrieval. A "tool call" written inside a web page is just text; there is no
  interpreter that runs it. This is source-based tool-injection defense.

## Cross-source exfiltration defense

The classic chain — *read private data, then smuggle it out* — is broken on both ends:

- **No egress.** Specialists have no write/send/post tool and no generic-HTTP tool;
  there is no channel to exfiltrate through.
- **Task scope + private-source minimization.** A specialist retrieves only within its
  task's source types ∩ profile allowlist and only the connections/knowledge bases the
  session authorized; **private content is never sent to public web search**. A source
  cannot induce a specialist to fetch unrelated private data — the scope is fixed by the
  orchestrator, not by anything a source says.
- **Private content stays access-controlled.** The report stores provenance + bounded
  excerpts; private source content is not copied wholesale, and a later reader only sees
  what their own permissions allow (access re-checked on every open).

## Kill switches

Server-controlled flags (`config.ts`), model/source can't override:

- `ADVANCED_RESEARCH_ENABLED=false` — the platform stops accepting/running research
  (a run resolves `BLOCKED`).
- `MULTI_AGENT_RESEARCH_ENABLED=false` — research still runs but **sequentially**
  (parallelism forced to 1).
- `RESEARCH_WEB_ENABLED=false` — web research is disabled; research **continues on
  internal data** (knowledge bases / connected).
- `RESEARCH_DISABLED_PROFILES="fact-checker,…"` — disable specific specialist profiles;
  the orchestrator skips any task assigned to a disabled or unknown profile.

## Org research policy

Because research runs in one workspace context and inherits the Phase 6/10 org model,
an org run is confined to that org's active workspace and verified membership. Per-org
research policy toggles and cost ceilings are governed through the plan/entitlement
columns and org context; richer org-scoped research policy UI is readiness. Effective
availability = platform flag **AND** plan entitlement **AND** (where relevant) org
context.

## Audit & security logging

Research emits **metadata-only** security events — never source content, excerpts, or
credentials: `research.started`, `research.plan_generated`, `research.task_started`,
`research.source_accessed`, `research.task_completed`, `research.claim_verified`,
`research.conflict_detected`, `research.synthesis_completed`, `research.budget_exhausted`,
`research.completed`, and `research.blocked` (a refused write/unknown profile). Admin
observability (`researchOverview`, `GET /api/admin/research`) is metadata + kill-switch
state only. Provider base URLs and keys stay **server-side and are never logged**, the
same posture as chat, RAG, connectors, agents, and multimodal.
