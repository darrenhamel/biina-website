# BIINA.ai — Action Approvals

Human-in-the-loop authorization for every side-effecting agent action. A write never
runs on the model's say-so; it runs only after a person sees an exact preview and
approves it. Approval is **server-authoritative** — bound to the precise arguments,
single-use, expiring, and owner-checked. Code:
`apps/web/src/server/agent/approvals.ts`, `preview.ts`, `hashing.ts`; route
`apps/web/src/app/api/agent/approvals/[id]/route.ts`. Companion:
`AGENT_ARCHITECTURE.md`, `TOOL_POLICY.md`, `AGENT_EXECUTION.md`.

## Lifecycle

When the policy engine returns `REQUIRE_APPROVAL` for a write, the orchestrator
creates an `agent_actions` row (status `PROPOSED`, `approvalStatus
AWAITING_APPROVAL`) and an `approval_requests` row, flips the run to
`AWAITING_APPROVAL`, and returns to the caller with a safe preview.

```
PENDING ──approve──► APPROVED ──consume (at execution)──► CONSUMED
   │                    │
   │                    └─ never re-usable: consume is atomic + single-use
   ├─ reject ─────────► REJECTED
   ├─ expire (TTL) ───► EXPIRED
   └─ edit ───────────► old EXPIRED, a NEW PENDING/APPROVED bound to new args
```

Every transition is enforced in SQL, never trusted from the browser.

## Action preview (`preview.ts`)

`buildActionPreview` derives a consistent, user-facing description **from the
normalized (to-be-approved) arguments** — the same arguments that will execute, so
what the user saw is exactly what runs. Previews carry the risk level, reversibility,
a title/description, affected resources, and per-kind fields:

- **email / draft** — recipients (to/cc), subject, a truncated body preview.
- **calendar** — title, date, time, guests, location.
- **slack** — channel + truncated message.
- **crm** — record id + field changes.
- **delete** — the affected resource id, flagged as permanent.

Previews **never contain secrets or tokens** and bodies are truncated. The stored
preview (`approval_requests.preview`) is exactly what the user approved.

## Argument-hash binding

The approval is bound to a SHA-256 hash of the **canonical, normalized** arguments
(`hashing.ts`). Normalization validates against the tool's Zod schema and
deep-sorts keys so the hash is stable regardless of key order.

```
argumentsHash = sha256( toolId + canonical(normalized args) )
```

If the model later changes the recipient, amount, date, destination, or content, the
hash changes and the **old approval no longer authorizes the new action**. Execution
re-computes the hash and `consumeApproval` matches on it in SQL — a mismatch yields
no row, so the write is blocked.

## Single-use

Consuming an approval flips `APPROVED → CONSUMED` in one atomic SQL `UPDATE` guarded
on `status = 'APPROVED'`. A replay finds no `APPROVED` row and returns null — the
action cannot run twice off one approval. This composes with the per-session
idempotency key (`AGENT_EXECUTION.md`) so duplicate writes are prevented from both
directions.

## Expiration

Each approval carries `expiresAt = now + AGENT_APPROVAL_TTL_MS` (default
**15 minutes**). An approval past its TTL cannot authorize anything: `decideApproval`
refuses to approve an expired request (and marks it `EXPIRED`), and `consumeApproval`
requires `expiresAt > now`. A stale "yes" is worthless.

## Ownership & tenant checks

- Only the **session's user** may decide an approval; a different user (or a wrong
  org context) is `forbidden`.
- `consumeApproval` re-checks `userId` **and** the org context (null-safe) at
  execution — an approval approved by one identity cannot be consumed under another.
- The approvals route first runs `resolveSessionAccess` (tenant isolation) and
  requires `canManage` before any decision.

## Edit → new hash

A user may **edit** the action before approving (`editedArguments` in
`approvalDecisionSchema`). The route:

1. re-normalizes + re-validates the edited arguments (invalid → 400);
2. computes a **new** hash + idempotency key;
3. **expires the old approval** and cancels the old action;
4. creates a **new action + approval bound to the edited args**, approves it, and
   resumes execution.

So execution always uses exactly what the user last approved — an edit can never
"slip through" on a hash the user did not see.

## Rejection

On `REJECTED`, the approval and action are marked rejected, and the orchestrator
records a `NOTE` step telling the model it was rejected and **not to attempt the
action again** — it may adjust or finish. The agent never re-asks the same rejected
action in a loop (loop detection also guards this).

## Resume after approval

`resumeAfterApproval` runs the approved write through the full execution gauntlet
(live rechecks + single-use consume), records a `VERIFY` step with the confirmed
outcome (or an explicit "could NOT be confirmed" note on `UNKNOWN_OUTCOME`), then
re-enters the loop so the model can confirm and produce a final answer. The model is
told never to claim success unless BIINA verified it.

## Standing authorizations — readiness only, NOT enabled

The data model leaves a clean seam for future "standing" or pre-authorized actions
(e.g. "always allow drafts to my own address"), but **Phase 11 does not enable
them**. Today **every** side-effecting action requires a fresh, single-use,
hash-bound, expiring approval. There is no blanket grant, no "approve all", and no
persisted per-tool auto-approve for writes — an `ALLOW` per-tool override is ignored
for writes by design (`TOOL_POLICY.md`).
