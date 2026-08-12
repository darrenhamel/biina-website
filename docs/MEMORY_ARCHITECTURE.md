# BIINA.ai — Memory Architecture

How BIINA.ai remembers durable facts and preferences across conversations —
**a distinct data category**, not "everything the user ever said." Memory is
selected, consent-gated, scoped, embedded for recall, revisable, and revocable.
It **never** overrides platform safety, org policy, or the current explicit
request, and it **never** authorizes an action. Code:
`apps/web/src/server/memory/`. Companion docs: [`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md),
[`PERSONALIZATION.md`](./PERSONALIZATION.md), [`MEMORY_PRIVACY.md`](./MEMORY_PRIVACY.md),
[`ORGANIZATION_MEMORY.md`](./ORGANIZATION_MEMORY.md), [`MEMORY_SECURITY.md`](./MEMORY_SECURITY.md).

## Six distinct data sources — memory is only one

BIINA.ai keeps six ways of "knowing something" **strictly separate**, so each
carries its own trust, provenance, and lifecycle. Memory is one of them, and the
smallest:

| Source | What it is | Trust / lifetime | Where |
|---|---|---|---|
| **Conversation history** | the messages of the current chat | in-thread, transient | `conversations`/`messages` |
| **Knowledge (RAG)** | uploaded files / knowledge bases | private, untrusted document text | Phase 8 vector store |
| **Memory** | durable, selected user/org facts + preferences | consent-gated, revocable, background context | `memories` |
| **Profile settings** | explicit style/tone/locale the user chose | authoritative account settings | `profiles` |
| **Organization context** | org-owned memory managed by managers | shared within one org only | `memories` (ORGANIZATION) |
| **Live data** | web + connected apps at question time | untrusted external, discarded after use | Phase 9/10 grounding |

Why they are not merged: conversation history is not memory (**not all
conversation is memorized**); a knowledge base is reference material a user
uploaded, not a fact BIINA inferred; profile settings are authoritative
instructions the user set, while memory is **background context** that never
overrides the request. Keeping them apart is what lets memory be honest,
auditable, and safe to turn off.

## The memory model

A memory (`memories` table) is a durable, single-sentence fact or preference
owned by **exactly one** domain — a personal user **XOR** an organization.

- **Type** (`memoryType`): `PREFERENCE` · `PROFILE_FACT` · `PROJECT_CONTEXT` ·
  `WORKING_RELATIONSHIP` · `ORGANIZATION_CONTEXT` · `RECURRING_INSTRUCTION` ·
  `CUSTOM`.
- **Source** (`sourceType`): `USER_EXPLICIT` (a "remember…" command or the
  memory API) · `CONVERSATION_INFERRED` (a consented candidate) ·
  `ADMIN_DEFINED` · `ORGANIZATION_DEFINED` · `WORKFLOW` · `IMPORT`. Source is
  provenance: it drives ranking and the "(inferred)" label the model sees.
- **Scope** (`scope`) + `scopeRef`: `GLOBAL` (always in range) · `PERSONA` ·
  `PROJECT` · `WORKFLOW` (in range only when the request's persona/project/
  workflow matches `scopeRef`) · `ORGANIZATION` (org-wide). Scoping keeps a
  project note out of unrelated chats.
- **Status** (`status`): `ACTIVE` · `SUPERSEDED` · `DELETED` · `EXPIRED`. Only
  `ACTIVE` is ever retrieved — the other three stop all recall.
- **Sensitivity** (`sensitivity`): `NORMAL` · `SENSITIVE` · `RESTRICTED`
  (classified deterministically on every write; see below).
- **Importance** (`0..100`, default 50) and **confidence** (`0..1`; explicit
  statements = `1.0`, inferred < 1) — both nudge ranking, never gate safety.
- **Expiry** (`expiresAt`): an optional durability horizon; an expired memory is
  excluded from retrieval **immediately** (the WHERE clause checks the clock),
  even before the cleanup job flips its status.
- **Embedding** (`embedding`/`embeddingModel`/`embeddingDim`): reuses the **RAG
  embedding provider** and cosine similarity — there is no second vector
  service. Embedding is computed on every create/edit.
- **Revisions**: every create/edit/supersede/delete writes an immutable
  `memory_revisions` row (`created`/`edited`/`superseded`/`deleted`, with
  `expired`/`imported` reserved) for audit and history.

## Explicit vs. inferred

Memory enters two ways, with very different trust:

- **Explicit** — the user says so. `parseExplicitMemoryCommand` deterministically
  recognizes `remember / note / keep in mind / don't forget …` and
  `forget / stop remembering / delete the memory …`. In chat these are handled
  **synchronously, at full confidence** (`confidence = 1`, `USER_EXPLICIT`,
  personal scope), short-circuiting the model with a confirmation
  (`X-Biina-Answer-Mode: MEMORY_COMMAND`). The memory API (`POST /api/memory`)
  is the other explicit path and is the only way to create org memory
  (managers, `ORGANIZATION_DEFINED`).
- **Inferred** — BIINA proposes. `extractCandidates` runs **best-effort, after
  the response**, only in `ASK`/`AUTO` mode, and only over **the user's own
  message text**. A pluggable extractor proposes structured candidates; a
  **deterministic offline fallback** ships here (durable "I prefer / I like /
  always …" and "working on project X" statements). Real deployments plug in a
  model extractor behind the same interface. Candidates are never memory until
  accepted.

## Candidates + consent modes

Inferred proposals land in `memory_candidates` as `PENDING` and are gated by the
user's `memoryMode` (on the profile):

- **OFF** — no inference at all (existing memory preserved, still no new
  inferred memory).
- **ASK** (default) — candidates are surfaced for the user to accept/reject
  (`GET /api/memory/candidates`, `POST /api/memory/candidates/[id]`). Nothing is
  saved without a decision.
- **AUTO** — low-risk `NORMAL` candidates are auto-accepted; anything
  `SENSITIVE`/`RESTRICTED` still requires an explicit decision with consent.

`extractCandidates` rejects a proposal before it can become a candidate if it is
a secret, an injected instruction, ephemeral, non-`NORMAL` auto-inference, or a
near-duplicate of existing memory. **Nothing is auto-saved unless AUTO mode +
low-risk.**

## Contradiction, dedup & consolidation

- **Dedup on write** — `createMemory` embeds the content and, if an active
  memory of the **same owner + type** is cosine-similar `≥ 0.95`, returns the
  existing one instead of inserting a twin. Inference uses a `≥ 0.9` pre-check.
- **Contradiction / supersede** — after a new memory is created,
  `supersedeConflicting` finds same-type memories that are semantically close
  (`0.7 ≤ sim < 0.95`) but **different in content** and marks them `SUPERSEDED`
  (linked via `supersededById`). The **newer statement wins**; the old one stops
  being retrieved but is preserved for audit. An explicit "remember" also
  supersedes conflicts, so correcting yourself works.
- **Consolidation readiness** — merging several related memories into one is a
  natural extension of dedup/supersede but is **not implemented**; today the
  system deduplicates and supersedes, it does not summarize clusters.

## Expiration & retention

`expiresAt` gives a memory a durability horizon. Retrieval excludes expired
memories in SQL (`expiresAt IS NULL OR expiresAt > now()`), so an expired memory
is **never used even before cleanup runs**. `markExpiredMemories` flips
`ACTIVE → EXPIRED` in bulk and is the seam a **background expiration job**
reuses; that scheduled cleanup is **readiness** (the function exists; no cron is
wired here). Plan-level `memoryRetentionDays` is a per-plan retention ceiling.

## The memory lifecycle

```
proposal ─(explicit)────────────────────────────────► ACTIVE
         └(inferred)─► PENDING candidate ─(accept+consent)─► ACTIVE
                                          └(reject)────────► REJECTED

ACTIVE ─(edit)──► ACTIVE (new revision, re-embedded)
       ─(newer same-type contradicts)──► SUPERSEDED
       ─(user/manager delete, or clear-all)──► DELETED
       ─(expiresAt passes)──► EXPIRED  (excluded from retrieval immediately)
```

Only `ACTIVE` memories are ever retrieved (see [`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md)
for how the few relevant ones become model context). Every transition is
audited and, for content changes, revisioned.
