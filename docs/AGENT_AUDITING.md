# BIINA.ai — Agent Auditing & Observability

Every meaningful agent decision leaves a **metadata-only** trail: what was proposed,
what was allowed or denied, what a human approved, and what actually executed and was
verified. No secrets, no argument contents, no external data are ever recorded. Code:
`apps/web/src/server/agent/` (`orchestrator.ts`, `execution.ts`, `admin.ts`),
`security_events`, `connector_usage_events`. Companion: `AGENT_SECURITY.md`,
`AGENT_EXECUTION.md`, `docs/USAGE_METERING.md`.

## Security events

The engine writes structured `security_events` at each control point:

| Event | Emitted when |
|---|---|
| `agent.session_started` | a run is created (`POST /api/agent/sessions`) |
| `agent.session_completed` | a run finishes with a final answer |
| `agent.session_canceled` | a run is canceled |
| `agent.session_blocked` | a run is stopped by a limit / block |
| `agent.tool_proposed` | the model proposes a tool |
| `agent.tool_allowed` | policy allows a read to run |
| `agent.tool_denied` | policy denies a proposed action |
| `agent.approval_requested` | a write pauses for human approval |
| `agent.approval_approved` | a user approves (metadata notes an edit) |
| `agent.approval_rejected` | a user rejects |
| `agent.action_executed` | a write completed **and was verified** |
| `agent.action_failed` | a write affirmatively failed |
| `agent.action_unknown_outcome` | a write's outcome could not be confirmed |
| `agent.policy_changed` | a platform/org/user policy is changed |

Together these reconstruct the full arc of a run — proposed → allowed/denied →
approved/rejected → executed/failed/unknown — without exposing content.

## What metadata is recorded (safe by construction)

Events carry only routing/operational fields: `sessionId`, `toolId`, `risk`,
`connectionId`, the **verified** `externalResourceId`, a `deduped` flag, a policy
`reason`, and the acting/owning user + org. They **never** carry tokens, credentials,
message bodies, recipients-as-content, or any external payload.

Persisted rows follow the same rule:

- **`agent_sessions`** — mode, status, the concise user-facing plan (not
  chain-of-thought), step/tool/write counters, estimated cost, budget, dry-run flag,
  timestamps.
- **`agent_steps`** — operational step type and **length-capped** input/output
  summaries. Model reasoning is never stored.
- **`agent_actions`** — tool, connection, risk, reversibility, **redacted** normalized
  arguments (bodies stored as a short preview + length, `hashing.ts`
  `redactForStorage`), arguments hash, idempotency key, status, verified resource id.
- **`approval_requests`** — the safe preview the user saw (no secrets), the arguments
  hash, decision + consume timestamps.

## Usage metering

Each executed write records a `connector_usage_events` row (metadata only —
connector, operation, connection, success, error code, request id), reusing the Phase
5 / Phase 10 metering ledger. Session-level counters (`stepsUsed`, `toolCallsUsed`,
`writeActionsUsed`, `estimatedCost`) are bumped atomically as the run progresses. The
agent is admitted per-plan by `assertAgentQuota` (daily/monthly session limits); plan
columns also carry `agentWriteActionsDailyLimit` and
`agentExternalMessagesDailyLimit` ceilings for write/external-message accounting.

## Cost accounting — a labelled estimate

Per-turn LLM cost is added to `estimatedCost` from `AGENT_ESTIMATED_TURN_COST`
(default `0`). It is explicitly an **estimate**, surfaced as such, and drives the
per-run cost budget (`costBudget`) that blocks a run when reached. It is not a billing
figure; real charges are governed by the Phase 5/7 billing system. The admin overview
rounds and labels it accordingly.

## Admin & org dashboards (`admin.ts`)

`agentAdminOverview` returns **operational metadata only** — never content, arguments,
or tokens — over the last 30 days:

- **session tallies** — total, completed, failed, blocked, awaiting-approval, active;
- **action tallies** — total, succeeded, blocked, rejected, unknown-outcome, writes;
- **averages** — average steps per run, summed estimated cost;
- **top tools** by count and a **recent runs** list (status, mode, truncated goal,
  steps, created-at).

Platform admins see the whole platform (`GET /api/admin/agents`); org managers see
only their org's activity (scoped by `organizationId`). Policy changes go through
`setAgentPolicy`, which writes an **admin audit** row (`agent.policy.update`) in
addition to the `agent.policy_changed` security event, so every safety-boundary
change is attributable to an actor.
