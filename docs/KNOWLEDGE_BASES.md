# BIINA.ai — Knowledge Bases

A **knowledge base (KB)** is a named collection of uploaded files whose text has
been indexed for retrieval. KBs are the unit a user selects when they want a chat
grounded in their own documents. Companion docs: `FILES.md`,
`RAG_ARCHITECTURE.md`, `RAG_SECURITY.md`. Code: `apps/web/src/server/rag/
knowledge-bases.ts`.

## Ownership model

A KB is owned by **a user XOR an organization** — never both:

| Kind | Owner | Who can read | Who can edit |
|---|---|---|---|
| **Personal KB** | a user | the owner only | the owner only |
| **Org KB** | an organization | any member of the org | org managers (`OWNER`/`ADMIN`) |

There is **no new permission system**. Access **reuses the Phase 6 org roles**
(see `AUTHORIZATION.md`), so KB access is governed by the same membership and
role logic as everything else in the org.

## Access resolution (`resolveKbAccess`)

Every KB operation resolves access **server-side**:

```
caller → resolve KB → verify ownership (personal) or membership+role (org) → grant | null
```

- Membership is verified against the DB, never inferred from a client-supplied id.
- No access → **null**, surfaced as a **404** — identical to "doesn't exist", so
  a KB's existence never leaks to a non-member (IDOR-safe, no existence leak).
- Editing an org KB additionally requires an org **manager** role; a plain member
  can read but not modify.

## Personal-file privacy across org membership

Personal and org knowledge are kept strictly separate, and org lifecycle events
**never** touch personal data:

- **Joining** an org never exposes your personal KBs or files to that org.
- **Leaving** an org never deletes or transfers your personal KBs or files.
- A personal KB is only ever readable by its owner; an org KB is only ever
  readable inside that org's workspace (see workspace scoping in
  `RAG_ARCHITECTURE.md` / `RAG_SECURITY.md`).

## Workspace scoping

KBs are bound to the **active workspace**. Org KBs are usable only while the user
is acting in that org's workspace; personal KBs only in the personal workspace.
Retrieval double-checks this at query time — Org A can never retrieve Org B's
knowledge, even at identical similarity.

## Plan gating

Reusing the Phase 5 plans:

| Field | Meaning |
|---|---|
| `ragEnabled` | RAG / KB usage enabled |
| `maxKnowledgeBases` | number of KBs an owner may create (`null` = unlimited) |
| `orgKnowledgeAccess` | may create/use **org** knowledge bases |

Org knowledge is a higher-tier capability (BUSINESS+); FREE gets small personal
limits. Enforced server-side in `knowledge-bases.ts`.

## Operations

- **Create / rename / delete** a KB (subject to access + plan limits).
- **Delete** purges the storage objects of the KB's files first, then cascades
  the DB rows (files + chunks), so no searchable embeddings remain.
- Files are uploaded into a KB and ingested through the `FILES.md` lifecycle.

## UI overview

Users manage KBs and their files from a knowledge area, and select one or more
KBs to ground a conversation. Filenames, KB titles, snippets, and citations all
render **RTL-safe** for Arabic content — original text is preserved, never
translated for indexing.
