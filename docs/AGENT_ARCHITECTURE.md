# BIINA.ai — Agent Architecture

How BIINA.ai plans and *acts* over the Phase 10 tool allowlist — a **bounded,
human-supervised agent engine**, not an autonomous one. The model **proposes**;
BIINA **authorizes, executes, limits, and audits**. The LLM is never the authority
on permissions, approvals, connector scopes, billing, or tenant boundaries. Code:
`apps/web/src/server/agent/`. Companion docs: `TOOL_POLICY.md`,
`ACTION_APPROVALS.md`, `AGENT_SECURITY.md`, `AGENT_EXECUTION.md`,
`AGENT_AUDITING.md`, `AGENT_ACTIVATION_CHECKLIST.md`.

## The division of authority

```
Model may:   PROPOSE · PLAN · SELECT a tool · REQUEST an action
BIINA does:  VALIDATE · AUTHORIZE · CONFIRM · EXECUTE · LIMIT · AUDIT
```

The model returns **exactly one JSON object per turn** (`plan` / `tool` / `final`).
BIINA parses it, decides whether anything runs, and does the running. A tool the
model "chooses" is only an input; the engine re-derives every privileged fact
(plan, org, role, policy, scope, credential) server-side and can refuse.

## Execution modes — AGENT is never the default

| Mode | Tools | Behavior |
|---|---|---|
| **CHAT** | none | Plain chat; the tool catalog is empty. |
| **ASSISTED** | reads + writes | Reads with an ALLOW policy run automatically; **writes always pause for human approval**. Schema default. |
| **AGENT** | reads + writes | Same gauntlet as ASSISTED, plus planning; still pauses every write for approval. |

The `agent_sessions.mode` column defaults to **`ASSISTED`**, and the start API only
accepts `ASSISTED` | `AGENT` (`startAgentSchema`). AGENT mode is opt-in per run and
never assumed. In every mode a write is gated by human approval — the modes differ
in planning and catalog exposure, not in write safety.

## The orchestrator loop

`orchestrator.ts` runs a bounded loop. Each turn assembles state, asks the model for
one decision, validates it, and either executes a read, pauses for a write, records
a note, or finishes.

```
User Goal
   │
   ▼
Context Assembly        (goal + tool catalog + operational history, server-rendered)
   │
   ▼
Planning / Tool Selection   (model → ONE JSON object: plan | tool | final)
   │
   ▼
Policy Engine           (decidePolicy: ALLOW / REQUIRE_APPROVAL / DENY)
   │
   ├── DENY ───────────► note back to model, do not run
   │
   ├── ALLOW (read) ───► ToolExecutionService → Connector Adapter → External Service
   │                          │
   │                          ▼
   │                     normalized result → history → loop
   │
   └── REQUIRE_APPROVAL (write)
          │
          ▼
       Approval Gate      (ActionPreview → human approves / edits / rejects)
          │  approved
          ▼
       Execution gauntlet (execution.ts: live rechecks → adapter write)
          │
          ▼
       Connector Adapter → External Service
          │
          ▼
       Result → Verification  (provider resource id, or UNKNOWN_OUTCOME)
          │
          ▼
       loop continues → model produces the final User Response
```

- **Context assembly** (`agent-prompt.ts` → `renderAgentState`) gives the model the
  goal, the **filtered** tool catalog (only tools it can actually use), and a bounded
  operational history (last 12 steps). It never contains secrets, credentials, or a
  prior chain-of-thought.
- **Reads that ALLOW run immediately.** Writes (and any read a policy raised to
  `REQUIRE_APPROVAL`) create an action + approval request and the run flips to
  `AWAITING_APPROVAL` — the loop returns to the caller.
- **`resumeAfterApproval`** executes the approved write through the full gauntlet,
  records a `VERIFY` step describing the confirmed outcome, then re-enters the loop
  so the model can confirm and produce a final answer.

## Bounds — every run is finite

The loop cannot run away:

- **Step limit** — `min(session.maxSteps, policy.maxStepsPerSession, hard limit)`.
  `AGENT_MAX_STEPS_DEFAULT` (8) seeds a session; `AGENT_MAX_STEPS_HARD_LIMIT` (20) is
  a ceiling the model can never raise.
- **Time limit** — `deadlineAt` from `AGENT_MAX_RUNTIME_MS` (120 s default).
- **Cost budget** — `estimatedCost` vs `costBudget`; the run blocks when reached.
- **Loop detection** — the same `toolId:argsHash` proposed more than twice blocks the
  run (`LOOP_THRESHOLD = 2`).
- **Malformed output** — more than two un-parseable model turns fails the run.

## Session / step / action model

Three persisted layers (`sessions.ts`, schema Phase 11):

- **`agent_sessions`** — one bounded run for a user goal: mode, status, plan
  (concise user-facing steps, **not** reasoning), step/tool/write counters, estimated
  cost, budget, dry-run flag, deadline.
- **`agent_steps`** — one operational step each: `PLAN` · `TOOL_READ` · `TOOL_WRITE`
  · `VERIFY` · `RESPOND` · `BLOCKED` / `NOTE`, with bounded input/output summaries.
- **`agent_actions`** — a concrete proposed tool call: tool, connection, risk,
  reversibility, normalized (redacted) arguments, arguments hash, idempotency key,
  status, and the verified external resource id once executed. A `UNIQUE(session,
  idempotencyKey)` constraint prevents duplicate writes.

Approvals live in **`approval_requests`** (single-use, expiring, hash-bound —
`ACTION_APPROVALS.md`); policies in **`agent_policies`** (`TOOL_POLICY.md`).

## No chain-of-thought storage

BIINA stores **operational** steps only — what tool was proposed, what a read
returned in summary, what a write's verified outcome was. The model's private
reasoning is **never** persisted, never returned by an API, and never shown to
another user. Plans are the model's own concise, user-facing step list, not its
hidden deliberation. Output summaries are length-capped, and message bodies are
stored as a short preview + length, never verbatim (`hashing.ts` `redactForStorage`).

## Tenant isolation

`resolveSessionAccess` mirrors connector isolation: a **personal** session belongs
to its owner alone; an **organization** session is reachable only within *that* org's
active workspace by a verified member, and only the initiating user can manage
(cancel / approve) it. A foreign or wrong-tenant id resolves to **null → 404** — no
existence leak. See `AGENT_SECURITY.md`.

## API surface

```
POST /api/agent/sessions            # start a bounded run (plan-gated, quota-checked, kill-switched)
GET  /api/agent/sessions            # list the caller's recent runs in the active scope
GET  /api/agent/sessions/[id]       # run detail: plan, steps, actions, pending approval (safe preview)
POST /api/agent/sessions/[id]/cancel# stop future steps + not-yet-started actions
POST /api/agent/approvals/[id]      # approve / reject / edit-then-approve a pending write
GET/PUT /api/admin/agents           # platform overview (metadata only) + platform policy
GET/PUT /api/orgs/[slug]/agent-policy # an org's agent policy (managers only)
```

All privileged context (plan, org, role) is derived from the session, never the
request body. The agent is gated by `plan.agentEnabled` + per-plan session quotas
and by the platform kill switch (`AGENT_EXECUTION_ENABLED`).

## What Phase 11 ships

Read tools run **live** (through the Phase 10 connector `ToolExecutionService`).
Writes run through a dedicated write path that is **mock by default**: the `mock`
and `crm` connectors execute the whole propose → approve → execute → verify path
offline, with no external side effects. Real Gmail / Calendar / Slack write adapters
are present but **structural** — they require live OAuth write scopes and the write
kill switch, both **off by default**. Enabling real external writes is a deliberate,
manual step: see `AGENT_ACTIVATION_CHECKLIST.md`.
