# BIINA.ai — Connector Architecture

How BIINA.ai reaches a user's **external applications** (Google Drive, Gmail,
Calendar, Slack, …) — **integration infrastructure, not a provider.** Connectors
never bypass Phase 4 routing or Phase 5 quotas, and the **LLM never speaks a
vendor API directly**. Every external access passes through server components.
Code: `apps/web/src/server/connectors/`. Companion docs: `OAUTH.md`,
`CONNECTOR_SECURITY.md`, `CONNECTED_SEARCH.md`, `GOOGLE_CONNECTORS.md`,
`TOOL_EXECUTION.md`, `CONNECTOR_ACTIVATION_CHECKLIST.md`.

## The layer

```
BIINA.ai → ConnectorService → Connector Registry → Provider Adapter → External Service
```

The rest of BIINA talks to **`ConnectorService`** (or `ToolExecutionService` above
it) — never to Google/Slack/etc. Only the adapter knows vendor specifics. Adding a
connector = a new adapter + a registry entry + env vars — **no frontend or DB
change** (mirrors the AI gateway and billing patterns).

## Seven separated concepts

Strict separation keeps secrets, identity, and permissions from bleeding together:

| Concept | What it is | Where |
|---|---|---|
| **Definition** | registry metadata for a connector (slug, category, scopes) — **no secrets** | `connector_definitions` |
| **Connection** | a user's or org's linked account (status, granted scopes) — **no tokens** | `connections` |
| **Credential** | the encrypted OAuth token set, server-only | `connector_credentials` |
| **Scope** | what the external grant permits (e.g. `drive.readonly`) | connection field |
| **Capability** | a normalized BIINA verb (`SEARCH`/`READ`/…) | registry vocabulary |
| **Resource** | a normalized external item (file/email/message/event/record) | `NormalizedResource` |
| **Action** | one allowlisted tool operation against a resource | `TOOL_ALLOWLIST` |

A **Definition** is safe to expose; a **Credential** never leaves the server (see
`CONNECTOR_SECURITY.md`).

## Registry vocabulary (`registry.ts`)

- **Capabilities** — READ: `SEARCH`/`LIST`/`READ`/`DOWNLOAD` (no side effect);
  WRITE: `CREATE`/`UPDATE`/`DELETE`/`SEND`/`COMMENT`/`SHARE`/`SCHEDULE`.
- **Categories** — Productivity / Email / Calendar / File Storage / Communication /
  CRM / Knowledge / Project Management / Developer Tools / Other.
- **RiskLevel** — `READ` · `LOW_RISK_WRITE` · `HIGH_RISK_WRITE` · `DESTRUCTIVE`,
  used by `ToolExecutionService` and future agents to gate actions.
- The catalog is **BIINA-controlled** in Phase 10 — no third-party marketplace.

## Adapter interface (`adapters.ts`)

The adapter is the **only** place a provider API is spoken:

```ts
interface ConnectorAdapter {
  readonly slug: string;
  readonly capabilities: Capability[];
  testConnection(cred): Promise<AccountInfo>;
  search?(cred, { query, max, signal }): Promise<NormalizedResource[]>;
  read?(cred, externalId, signal): Promise<ExternalContent>;
  // write methods declared for the future; execution is gated + disabled
}
```

Adapters declare their capabilities; an unsupported operation is simply not
implemented. A factory (`getAdapter`) resolves by slug, with a test-injection hook.

## Normalized resource, content & provenance

Every connector returns the **same shapes**, so the AI layer never sees a vendor
payload:

- `NormalizedResource` — `{ connectorSlug, resourceType, externalId, name, mimeType?,
  url?, createdAt?, updatedAt?, snippet?, metadata? }`. `resourceType` is one of
  `CONNECTED_FILE`/`_EMAIL`/`_MESSAGE`/`_EVENT`/`_RECORD`.
- `ExternalContent` — a resource plus `{ contentType, text?, structuredData? }`.
- **Provenance** rides every result (`{ connector, connectionId }`), so a cited
  answer always traces back to the exact account it came from.

## Connection ownership — personal XOR org

A connection belongs to a **user** or an **organization**, never both:

- **PERSONAL** — usable only by its owner; never shared into an org.
- **ORGANIZATION** — usable only within *that* org's active workspace by a verified
  member; Org A can never reach Org B's connection.

`resolveConnectionAccess` (`connections.ts`) enforces this server-side; a
mismatched or foreign id resolves to **null → 404** (no existence leak). Personal
and org connections are **distinct security domains** — see `CONNECTOR_SECURITY.md`.

## Live retrieval, not indexed (yet)

Phase 10 does **live retrieval** each turn — a connector search/read runs at
question time, is grounded, cited, and discarded. There is **no sync-into-KB
engine, no result cache, and no webhooks** yet; the architecture leaves seams for
all three (an indexed path would feed the Phase 8 vector store behind the same
interfaces). Connected content is grounding context, not stored knowledge.

## Adding another connector

1. Implement a `ConnectorAdapter` in `adapters.ts` (or a new module) — normalize
   the vendor payload into `NormalizedResource` / `ExternalContent`.
2. Register read tools in `TOOL_ALLOWLIST` (`registry.ts`) with capability + risk.
3. Add an OAuth provider case in `oauth.ts` (or reuse Google) + its env vars.
4. Seed a `connector_definitions` row (safe metadata, scopes, personal/org support).
5. Enable it in **Admin → Connectors** once OAuth is configured.

No route-handler, frontend, or schema change is required — that is the whole point
of the layer.
