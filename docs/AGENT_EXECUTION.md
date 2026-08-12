# BIINA.ai — Agent Execution

How a write actually runs — the **execution gauntlet**. Reads delegate to the Phase
10 connector `ToolExecutionService`; writes run through a dedicated path that treats
every external call as potentially ambiguous and **never claims success without a
verified provider resource id**. Code:
`apps/web/src/server/agent/execution.ts`, `write-adapters.ts`, `hashing.ts`.
Companion: `AGENT_ARCHITECTURE.md`, `ACTION_APPROVALS.md`, `AGENT_SECURITY.md`.

## Reads (`executeReadAction`)

A read with an ALLOW policy runs immediately through
`executeTool` → `ConnectorService` → adapter (the Phase 10 allowlisted path). The
result is normalized into a **bounded, model-facing summary** — the first few items
or a truncated content excerpt — never a giant raw provider payload. Success/failure
is recorded on the action; no approval is needed for a read.

## The write gauntlet (`executeWriteAction`)

A write is the sole path with external side effects, and it runs a strict ordered
gauntlet. **Any** failed check blocks the action and audits it — nothing runs on a
stale snapshot:

```
1. Kill switches      AGENT_EXECUTION_ENABLED · AGENT_WRITE_ACTIONS_ENABLED · AGENT_DISABLED_TOOLS
2. Dry-run            input.dryRun OR AGENT_DRY_RUN → record "DRY_RUN (not executed)", stop
3. Idempotency        already performed in this session? → reuse the prior result, no new side effect
4. Live policy        decidePolicy again with the CURRENT effective policy → DENY blocks
5. Consume approval   atomic, single-use, hash-bound, owner+org-checked → no row → block
6. Live connection    resolveConnectionAccess: ACTIVE + slug matches the tool (token may be revoked)
7. Live entitlement   getPlan: plan.agentEnabled still true (downgrade mid-session blocks)
8. Load credential    server-only; never returned, logged, or shown to the model
9. Adapter write      the ONE external call
10. Verify            provider resource id required → else UNKNOWN_OUTCOME (never success)
   → meter + audit
```

Only after all ten does a side effect occur, and even then success is contingent on
verification.

## Idempotency & duplicate-write prevention

Every action carries an idempotency key derived from `(sessionId, toolId,
argumentsHash)` (`hashing.ts`). Two guards prevent a duplicate external write:

- **Platform ledger** — before writing, `findExecutedAction` looks up a prior
  `SUCCEEDED` action with the same key in the session and, if found, **reuses its
  result** (returns the existing external resource id) instead of writing again. A
  `UNIQUE(session, idempotencyKey)` DB constraint backs this.
- **Adapter dedupe** — the write adapter is also handed the key. The mock adapter
  keeps an in-memory ledger and returns the **original** resource with `deduped:true`
  on a repeat, proving the same key never produces a second side effect. A real
  provider would use its own idempotency mechanism.

Combined with single-use approvals (`ACTION_APPROVALS.md`), a write cannot run twice
from one approval **or** from a repeated identical proposal.

## Result verification

A write **succeeds only if the adapter returns a verified provider resource id.**

- `SUCCEEDED` **with** an `externalResourceId` → record success + the id, bump the
  write counter, meter, and audit `agent.action_executed`.
- `SUCCEEDED` **without** an id → downgraded to **`UNKNOWN_OUTCOME`**; the run records
  it and audits `agent.action_unknown_outcome`. Success is **never** claimed on a
  missing id.

The verified id is what the `resumeAfterApproval` `VERIFY` step reports back to the
model; the model is instructed never to tell the user an action succeeded unless
BIINA confirmed it.

## Read-after-write

The verified provider resource id is the read-back handle: it is stored on the action
(`externalResourceId`), surfaced in the session detail API, and used to confirm the
write landed. The adapters return the provider's own id (Gmail message id, Calendar
event id, Slack `ts`), so a follow-up read can address the exact object created.

## UNKNOWN_OUTCOME handling

An ambiguous outcome — a provider **timeout**, a network exception, or a success
without an id — is recorded as `UNKNOWN_OUTCOME`, **never** as success or a clean
failure. The engine:

- audits `agent.action_unknown_outcome` and meters it as unsuccessful;
- tells the model the outcome **could not be confirmed** and that it must not claim
  success — manual verification is required;
- **does not auto-retry** (see below).

`UNKNOWN_OUTCOME` is a first-class action + session state so operators can find and
reconcile ambiguous writes.

## Partial failure & network / timeout handling

The single external call is wrapped: a thrown exception (network error, aborted
request) is caught and mapped to `UNKNOWN_OUTCOME` — the request may or may not have
taken effect, so BIINA refuses to assume either way. A clean provider `FAILED` (the
provider affirmatively rejected the request) is recorded as `FAILED`. The distinction
matters: `FAILED` is safe to surface as "did not happen"; `UNKNOWN_OUTCOME` is not.

## Safe retries — only idempotent

BIINA **never auto-retries** an ambiguous write. Because the outcome is unverified, a
blind retry risks a duplicate side effect (a second email, a second event). Recovery
is deliberate: a re-proposal of the **same** normalized action carries the **same**
idempotency key, so if the first attempt had in fact succeeded, the ledger/adapter
dedupe returns the original result rather than creating a duplicate. Retrying is thus
safe **only** through the idempotent path, never as an automatic loop — and loop
detection blocks a model that repeats the same call.

## Compensating actions & reversibility — readiness

Each tool carries a `Reversibility` tag (`REVERSIBLE` / `PARTIALLY_REVERSIBLE` /
`IRREVERSIBLE`), recorded on every action and shown in the preview, so a user knows
before approving whether an action can be undone. Phase 11 uses this for disclosure
and to keep destructive/irreversible actions denied by default; it does **not** yet
run automatic compensating actions (undo/rollback). The tag and the stored verified
resource id are the seam a future compensating-action step would build on. Today the
safe posture is: irreversible and destructive actions are denied or require explicit
approval, and nothing is auto-undone.

## Metering & audit

Every executed write records a `connector_usage_events` row (metadata only —
connector, operation, connection, success, error code) and a `security_events` entry
(`agent.action_executed` / `agent.action_failed` / `agent.action_unknown_outcome`).
No tokens, no argument contents, no external data are ever recorded
(`AGENT_AUDITING.md`).
