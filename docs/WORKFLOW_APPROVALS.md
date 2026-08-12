# BIINA.ai — Workflow Approvals & Standing Authorizations

How a scheduled, unattended automation handles the one thing it cannot do safely on its
own: an **external write**. The rule is inherited from Phase 11 and unchanged —
**every write pauses for a human** — with exactly **one** narrow escape hatch that a
person deliberately opens: a **standing authorization**. Code:
`apps/web/src/server/workflows/runner.ts`, `standing-auth.ts`. Companion docs:
[`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md), [`WORKFLOWS.md`](./WORKFLOWS.md),
[`ACTION_APPROVALS.md`](./ACTION_APPROVALS.md) (the Phase 11 approval primitive).

## Approval policies

A workflow carries one `approvalPolicy` (also settable on a reusable agent definition):

| Policy | Reads | Writes |
|---|---|---|
| **READ_ONLY_AUTOMATIC** | run automatically | **never** auto-run — a write is not even attempted unattended; the run stops for a human (or simply does no writing). |
| **ASK_HIGH_RISK_ONLY** | run automatically | lower-risk writes may proceed **only** via a matching standing authorization; still no un-authorized write. |
| **ASK_EVERY_WRITE** | run automatically | every write pauses for approval unless a matching standing authorization covers it. |

Two things hold across all three: reads with an ALLOW policy run automatically, and a
write **never** executes unattended without an explicit standing authorization. The
policy tunes *how much* is asked, never whether the underlying Phase 11 gate applies.
`READ_ONLY_AUTOMATIC` short-circuits the auto-approval loop entirely — it will not
consume a standing authorization even if one exists.

## Per-run approval during a background run

When an unattended run reaches a write it cannot auto-approve, it does **not** hold a
worker open waiting for a human:

1. The Phase 11 session flips to `AWAITING_APPROVAL` and creates a single-use,
   expiring, hash-bound approval request (the standard `ACTION_APPROVALS.md` primitive).
2. The `WorkflowRun` **persists** as `AWAITING_APPROVAL` and the runner returns — the
   tick / worker is freed immediately.
3. The owner is **notified** (`approval_needed`, in-app; deduped by run) so they can
   review the exact `ActionPreview` (recipient + content, no secrets) at their leisure.

The run is durable state in the database, not an in-flight process. A run can sit
awaiting approval indefinitely without occupying compute.

## Approval resume — continuation, not restart

A human decides via `POST /api/workflows/runs/[runId]/approve` (`{ approvalId,
decision }`), which must be an authorized manager of the workflow.
`resumeWorkflowRunAfterDecision`:

- **REJECTED** → the agent is advanced so it can adapt or stop; the write does not run.
- **APPROVED** → the approved action resumes through the Phase 11
  `resumeAfterApproval` gauntlet, and the runner **continues driving** the *same* agent
  session from where it paused — enqueuing the continuation, **not restarting the run
  from scratch**. Steps already done are not redone; the session's counters carry
  forward. Any further writes are handled the same way (auto if standing-auth-covered,
  else pause again).

The run then finalizes to its terminal status (`COMPLETED` / `BLOCKED` / `FAILED` /
another `AWAITING_APPROVAL`), records counters, and notifies per policy.

## Approval expiration & multiple approvals

- **Expiration.** Approval requests are single-use and **expiring** (the Phase 11
  `AGENT_APPROVAL_TTL_MS`, default 15 min). An expired approval can't be consumed; the
  write does not run on a stale decision. Because the run is durable, an expired
  approval leaves the run awaiting a fresh decision rather than silently proceeding.
- **Multiple approvals.** A run that proposes several writes creates a **separate**
  approval per action, each hash-bound to its own exact arguments and tracked
  independently. Approving one authorizes exactly that action — editing an action
  rebinds a new hash, invalidating the old approval. Nothing is approved in bulk by
  side effect.

## Standing authorizations — the only unattended write path

A standing authorization is the deliberate, **narrow** grant a human creates so a
*specific* recurring write can run without a per-run tap. It is intentionally the
opposite of a blanket "let this automation send email" switch.

### Narrow binding

Each authorization (`standing_authorizations`) is bound to **all** of:

- a single **workflow** (`workflowId`);
- a single **tool** (`toolId`, must be a *write* tool);
- a single **connection** (`connectionId`);
- an **exact destination allowlist** (`allowedDestinations`, lowercased) — recipients
  for email/draft, the channel for Slack, guests for a calendar event, the record id
  for CRM;
- a **risk ceiling** (`riskCeiling`, taken from the tool's own risk at creation);
- **execution limits** — optional `maxExecutions` (total) and `maxExecutionsPerDay`;
- an **expiry** (`expiresAt`, up to 365 days; default 90).

A write is auto-approved **only** if it matches the workflow + tool + connection,
is within the risk ceiling, targets **only** destinations in the allowlist (every
destination must be listed — one stray recipient disqualifies it), the authorization is
unexpired and `ACTIVE`, and it has remaining total/day executions
(`matchStandingAuthorization`). Otherwise the write falls through to human approval.

### Creation *is* the explicit approval

There is no separate "approve this authorization" step — **creating one is itself the
explicit, authenticated user action**. `POST /api/workflows/standing-auth` requires
`confirm: true`, that the caller **manages the workflow**, and that they own/manage the
**connection**; `approvedByUserId` is set to the creator. A standing authorization is
never inferred, never created by the agent, and never created by injected content — it
requires a human with manage rights to POST it. Only write tools are eligible, and at
least one bound destination is mandatory.

### Recipient / channel / calendar binding

The destination allowlist is what makes the grant *narrow*: "this workflow may email
**only** these two addresses via **this** Gmail connection", or "post **only** to
**#sales-alerts**", or "create events with **only** these guests". A message the
automation is tricked into sending to any other recipient is **not covered** and pauses
for approval — the binding is the anti-exfiltration lock.

### Atomic consumption (no concurrent over-limit)

When a match is found, the runner consumes one execution **atomically** before the
write runs (`consumeStandingAuthorization`): a guarded `UPDATE … SET executionsUsed =
executionsUsed + 1 WHERE status='ACTIVE' AND expiresAt > now() AND (maxExecutions IS
NULL OR executionsUsed < maxExecutions)`. If the guard matches no row (over limit,
expired, revoked), consumption **fails and the write falls back to human approval**.
Because the increment and the limit check are one statement, concurrent runs can
**never** exceed the cap by racing. Use of an authorization is audited
(`workflow.standing_auth_used`).

### Live recheck, immediate revocation

Every run re-checks the authorization from scratch — expiry, status, limits, and
destination match are all evaluated live, never cached from creation. Revocation is
**immediate**: `DELETE /api/workflows/standing-auth/[id]` flips status to `REVOKED`
(only the creator may revoke), and the very next run's match/consume fails, so no
further write is auto-approved. There is no propagation delay.

### The extra global gates on scheduled writes

Even a perfectly matching standing authorization is not sufficient by itself. For a
**scheduled** run (`SCHEDULE`/`CONDITION` trigger), the runner additionally requires:

- `WORKFLOW_SCHEDULED_WRITES_ENABLED=true` (**default false**) — otherwise the
  scheduled write is **BLOCKED** with "a person must run/approve this"; and
- the tool is not in `WORKFLOW_DISABLED_TOOLS`; and
- the underlying Phase 11 `AGENT_WRITE_ACTIONS_ENABLED=true` (real writes off by
  default).

So unattended scheduled writes need **both** an explicit standing authorization **and**
the default-off scheduled-writes switch (on top of the Phase 11 write switch). A manual
run isn't subject to the scheduled-writes switch, but its writes still need approval or
a standing authorization. A hard cap of at most 5 auto-approvals per run
(`min(maxWritesPerRun, 5)`) bounds any single run regardless.

## Org-approval readiness

Routing an automation's approval to a *different* org manager (or an approval queue /
delegated approver) is **readiness, not built** in Phase 12. Today the workflow's
managing user approves paused runs and creates standing authorizations. Multi-party or
delegated org approval is a future layer on the same primitives.

## Notifications

Approval requests and outcomes are surfaced through the provider-independent
notification service (in-app persisted + optional email), **deduped** by `(user,
dedupeKey)` so retries and unchanged conditions never double-alert: `approval_needed`
when a run pauses, `failure` on failure, `result` on a meaningful completion,
`auto_paused` when consecutive failures trip the breaker.

## API surface

```
POST   /api/workflows/runs/[runId]/approve  # approve / reject a paused run ({approvalId, decision})
POST   /api/workflows/standing-auth         # create a narrow standing authorization (confirm:true)
GET    /api/workflows/standing-auth         # list the caller's standing authorizations
DELETE /api/workflows/standing-auth/[id]    # revoke immediately (creator only)
```
