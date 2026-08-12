# BIINA.ai — Organization Memory

Organization-owned memory — shared context (conventions, project facts, working
relationships) that belongs to an **organization**, not to any one member.
Personal and organization memory are **separate security domains**; Org A's
memory can never appear in Org B, and personal context never includes org memory.
Code: `apps/web/src/server/memory/store.ts` (`resolveMemoryAccess`) +
`retrieval.ts`. Companion docs: [`MEMORY_ARCHITECTURE.md`](./MEMORY_ARCHITECTURE.md),
[`MEMORY_SECURITY.md`](./MEMORY_SECURITY.md), [`ORGANIZATIONS.md`](./ORGANIZATIONS.md).

## Org-owned, not member-owned

An `ORGANIZATION` memory has `ownerType = ORGANIZATION`, an `organizationId`, and
**no** `ownerUserId`. It is the org's, not the creator's:

- It survives the creator leaving — a departing member does **not** delete org
  memory (contrast personal memory, which is the user's).
- It is only ever visible inside **that org's active workspace**, to verified
  members of that org.

Deleting the organization cascades its memories away (`ON DELETE CASCADE` from
`organizations`).

## Manager-only management

Ordinary members **cannot** create, edit, or delete organization memory.
`resolveMemoryAccess` derives `canManage` from the member's role:

- For an org memory, it requires the memory's `organizationId` to equal the
  caller's **active** org, the caller to be a **verified member**, and
  `isOrgManager(role)` (OWNER/ADMIN) to be true before edit/delete is allowed.
- `POST /api/memory` with `ownerType = ORGANIZATION` requires the plan's
  `organizationMemoryEnabled` **and** a manager role in the active workspace, and
  is stored as `ORGANIZATION_DEFINED`.

A normal member sees org memory used in their answers but cannot modify the
shared set — exactly like org policy.

## Scope & expiration

Org memories use the same model as personal ones ([`MEMORY_ARCHITECTURE.md`](./MEMORY_ARCHITECTURE.md)):
type, `scope`/`scopeRef` (an `ORGANIZATION`-scoped memory is org-wide;
`PROJECT`/`WORKFLOW` scoping narrows it), `importance`, `confidence`,
`expiresAt`, revisions, dedup, and supersede — all tenant-scoped to the org.
Expiry and retention behave identically (expired ⇒ excluded from retrieval
immediately; `memoryRetentionDays` is a plan ceiling).

## Execution-context isolation — Org A ≠ Org B

Isolation is enforced in the retrieval **candidate WHERE**, which *is* the
boundary:

- **Org context** (a request in an org workspace) draws the user's **personal**
  memories **plus that org's** `ORGANIZATION` memories — and nothing else.
- **Personal context** (no active org) draws **only** the user's personal
  memories; **no org memory leaks in**.
- A memory of Org A is only ever a candidate when the active org **is** Org A.
  There is no code path that returns Org B's memory inside Org A's execution
  context.

Ownership and tenant are re-derived server-side from the session + verified
membership; the browser can never assert an `organizationId` for someone else,
and a foreign or wrong-tenant memory id resolves to **null → 404** (no existence
leak). This mirrors connector and agent tenant isolation.

## Audit

Org memory changes emit the same metadata-only security events as personal
memory (`memory.created` / `edited` / `deleted` / `superseded`), stamped with the
`organizationId` and the acting user — never the memory content. Every content
change also writes an immutable `memory_revisions` row (who, when, what change
type).

## Admin visibility — own org only

- **Org managers** may inspect and manage their **own** org's memory content
  through the memory API (scoped to the active org by `resolveMemoryAccess`).
- **Platform admins** get only the operational **health** view
  (`GET /api/admin/memory`) — counts and embedding health, **no private
  content**, personal or organizational. There is no cross-org content view.

A manager's reach ends at their org boundary; nobody browses another
organization's memory.
