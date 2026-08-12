# BIINA.ai — Tool Execution

`ToolExecutionService` is the **single gateway** for every connector operation — the
one place a tool against an external app is dispatched. It runs **only allowlisted
tools**, derives identity **server-side**, and **disables all writes** in Phase 10.
Agents (Phase 11) will call **this** service, not adapters. Code:
`apps/web/src/server/connectors/tool-execution.ts` + `registry.ts`. Companion:
`CONNECTOR_ARCHITECTURE.md`, `CONNECTOR_SECURITY.md`, `CONNECTED_SEARCH.md`.

## The single gateway

```
caller (chat / agent) → executeTool(ToolRequest) → allowlist check → risk gate
                       → resolveConnectionAccess (isolation) → ConnectorService → adapter
```

Everything that touches a connector goes through `executeTool`. There is no side
door to an adapter or a provider API.

## The tool allowlist

`TOOL_ALLOWLIST` (`registry.ts`) is the **exhaustive** set of operations that may
ever run. A tool id not in the list is rejected outright (`Unknown tool`). Each
entry is `{ id, connectorSlug, operation, capability, risk, enabledByDefault }`.

| Tool id | Connector | Capability | Risk | Default |
|---|---|---|---|---|
| `mock.search` / `mock.read` | mock | SEARCH / READ | READ | **on** |
| `drive.search` / `drive.read` | google-drive | SEARCH / READ | READ | **on** |
| `gmail.search` / `gmail.read` | gmail | SEARCH / READ | READ | **on** |
| `calendar.list` | google-calendar | LIST | READ | **on** |
| `slack.search` | slack | SEARCH | READ | **on** |
| `gmail.send` | gmail | SEND | HIGH_RISK_WRITE | **off** |
| `calendar.create` | google-calendar | CREATE | LOW_RISK_WRITE | **off** |
| `drive.delete` | google-drive | DELETE | DESTRUCTIVE | **off** |

## Risk classification

Every tool carries a `RiskLevel`: `READ` (no side effect) · `LOW_RISK_WRITE` ·
`HIGH_RISK_WRITE` · `DESTRUCTIVE`. The gate and the future confirmation UI key off
this level — a `DESTRUCTIVE` delete will demand stronger confirmation than a
`LOW_RISK_WRITE` create.

## Read-tool policy

A read tool resolves connection access (**isolation** — `resolveConnectionAccess`
returns null → `404` for a foreign/wrong-tenant id), verifies the tool's connector
matches the connection, logs `connector.action_attempted`, then dispatches to
`ConnectorService` (`searchConnection` / `readConnection`). The query is truncated
to a bound; results come back normalized with **provenance** `{ connector,
connectionId }`.

## Write-tool policy — disabled by default

For any tool whose risk is **not** `READ`:

```
enabled = writeToolsEnabled()  (CONNECTOR_WRITE_ACTIONS_ENABLED === 'true')
          AND tool.enabledByDefault
```

Since every write tool ships with `enabledByDefault=false`, writes are **off** in
Phase 10 regardless of the env flag. A blocked write **executes nothing**, logs
`connector.action_blocked`, and returns `ACTION_NOT_ENABLED`. Even if execution
somehow fell through, the trailing branch returns `ACTION_NOT_ENABLED` — a write
never reaches an adapter.

## Server-derived identity

`ToolRequest.actorUserId` and `activeOrganizationId` are set from the **server
session**, never from the browser. A client cannot claim to be another user or
another org to widen its access — the same posture as the rest of BIINA.

## Request / result models

```ts
ToolRequest  { toolId, actorUserId, activeOrganizationId, connectionId,
               operation?, arguments, requestId? }
ToolResult   { success, data?, error?{code,message}, provenance?{connector,connectionId}, requestId? }
```

The normalized `ToolResult` is provider-agnostic — a caller never sees a vendor
payload or a raw credential.

## Why there is no arbitrary-HTTP tool

There is deliberately **no "fetch a URL" and no "call an arbitrary API" tool**. That
single design choice removes the SSRF, arbitrary-side-effect, and exfiltration
classes at the root: the model can only ever invoke a **named, reviewed** operation
against a **named** connector the user already authorized. Capability, not
open-ended reach, is the contract.

## How agents will use it later (Phase 11)

The Phase 11 agent engine will **plan** over the allowlist and **call
`executeTool`** for each step — inheriting the allowlist, isolation, server-derived
identity, metering, and audit for free. Enabling writes will additionally require a
user-facing **ActionPreview / confirmation** step (surface the exact action + risk,
get explicit approval) before a write tool runs. Those preview/confirmation seams
are prepared; no autonomous action ships in Phase 10.
