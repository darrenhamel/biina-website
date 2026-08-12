# BIINA.ai — Connected Search

How a chat is grounded in the user's **connected external applications** — the
third grounding source alongside private knowledge (Phase 8) and the live web
(Phase 9). Connected data is **PRIVATE**: it never leaves for a public search
provider, never crosses tenants, and never becomes a web citation. Code:
`apps/web/src/server/connectors/connected-search.ts`; companion:
`CONNECTOR_ARCHITECTURE.md`, `CONNECTOR_SECURITY.md`, `TOOL_EXECUTION.md`,
`CITATIONS.md`.

## `ConnectedSearchService`

`searchConnectedSources` searches **explicitly selected** connections and returns a
`ConnectedGrounding` — `{ instructions, contextBlock, citations, hasEvidence }`.
It is invoked from the chat route only when the user selected connections **and**
`plan.connectorsEnabled` is true.

## Explicit source selection

Connected search is **never automatic**. The chat request carries `connectionIds`
the user chose; nothing is searched implicitly. Each id is:

- **de-duplicated** and capped (max 8 connections per turn);
- **re-verified per connection** via `resolveConnectionAccess` **before** any
  provider call (isolation — a foreign/wrong-tenant id is silently skipped);
- skipped unless the connection is **ACTIVE**.

The query sent to each connector is the **user's question only** — never other
private text (see `CONNECTOR_SECURITY.md`).

## Grounding orchestration

The three grounding sources run **independently**, with **separate permissions and
provenance**, then combine under one server-authoritative policy:

```
Knowledge retrieval (Phase 8)   → PRIVATE KNOWLEDGE block   (scope-verified)
Web grounding      (Phase 9)   → PUBLIC WEB block          (SSRF-guarded)
Connected search   (Phase 10)  → CONNECTED APP block        (per-connection re-verified)
```

Each stays in its **own labeled block** in the system prompt
(`system-prompt.ts`) — the model is told to keep them distinct and, when they
**conflict**, to surface the disagreement rather than merge them.

## Source-type model

Connected results extend the unified citation model (`CITATIONS.md`):

| `sourceType` | Origin |
|---|---|
| `PRIVATE_DOCUMENT` | a knowledge-base chunk (Phase 8) |
| `WEB_PAGE` / `SEARCH_SNIPPET` | fetched public page / snippet (Phase 9) |
| `connector` (`CONNECTED_FILE`/`_EMAIL`/`_MESSAGE`/`_EVENT`/`_RECORD`) | connected app |

A `ConnectorCitation` carries `{ connector, connectionId, externalId, name,
resourceType, retrievedAt }`, so a claim traces to the exact account and item.

## Context block & injection framing

Results are wrapped in **delimited, numbered `CONNECTED_SOURCE` blocks** and framed
as **untrusted data, not instructions** — the same defense as RAG and web.
`connectedInstructions()` tells the model to treat the content as quoted material,
never to follow embedded instructions, never to expose it publicly or cross-tenant,
and to cite sources by name (e.g. "Q3 Forecast — Google Drive") without fabricating
links. When nothing relevant is found, the model is told to say so, not invent it.

## Citations & permission-checked re-open

Citations are returned via the citations header alongside RAG/web citations. Opening
a connected citation **re-checks authorization** at click time (the connection must
still resolve and be active) — a revoked or expired connection can't be re-opened
from an old answer.

## Currentness & conflict surfacing

Each result records a `retrievedAt` timestamp — connected data is **live-fetched
each turn**, not cached, so freshness is current. When connected content disagrees
with a document or a web page, the model surfaces the difference rather than
silently picking one.

## Content-size limits — reuse of the Phase 8 budget

Connected content reuses the RAG **extraction / chunking / token-budget** machinery
(`estimateTokens`): each source body is capped (~3 KB), the block honors a
context-token budget (~2400 tokens) prioritizing earlier evidence, and per-connection
result counts are bounded (default 4, max 8). A large mailbox or drive can never
blow the context window.

## Quotas & metering

Connected search is plan-gated:

- `plan.connectorsEnabled` gates the feature entirely;
- `connectedSearchDailyLimit` / `connectedSearchMonthlyLimit` cap successful search
  ops (UTC day/month windows; **failed ops don't count**), enforced from the
  `connector_usage_events` ledger before any provider call.

Over-quota throws a typed `quota_exceeded` (→ `429`); a disabled plan (→ `403`).
Every op meters a `connector_usage_events` row (metadata only).

## Graceful degradation

A **non-quota** connector failure (provider down, one connection errors) does **not**
fail the chat — that connection is skipped and BIINA answers with whatever grounding
succeeded. **Quota and entitlement** errors are the exception: they surface as
`429` / `403` so the user knows the request was refused, not silently downgraded.

## Known limitations

- **Live retrieval only** — no sync-into-KB engine and **no cache**; every turn
  re-fetches. Latency and provider quotas apply per turn.
- **Read-only** — connected search reads; it never writes (see `TOOL_EXECUTION.md`).
- **Attachments** — reading a connected file's bytes through the Phase 8 document
  pipeline is a prepared seam, not yet wired end-to-end.
