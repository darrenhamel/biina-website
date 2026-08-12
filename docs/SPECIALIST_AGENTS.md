# BIINA.ai — Specialist Research Agents

The specialist agents advanced research dispatches. Every specialist is a **bounded,
read-only, tool-minimized executor** — configuration, not a principal. It has **no
credentials, no independent permissions, and no write tool of any kind.** Being a
"specialist" grants no additional authority. Code:
`apps/web/src/server/research/profiles.ts` (registry) and `specialists.ts` (executor).
Companion: [`MULTI_AGENT_ORCHESTRATION.md`](./MULTI_AGENT_ORCHESTRATION.md),
[`RESEARCH_SECURITY.md`](./RESEARCH_SECURITY.md).

## Profiles are configuration only

A `SpecialistProfile` (`profiles.ts`) is a static record: an id, a specialization, a
**minimized** allowlist of read-only tools, an allowlist of source types the profile
may touch, and per-profile step/source caps. A profile does **not** own credentials or
permissions — a specialist gets only the tools its *task* needs (task grant ∩ profile
allowlist), and the actual authorization for any retrieval is re-derived by the
underlying tenant-isolated retrieval layer, not by the profile.

## The registry

`SPECIALIST_PROFILES` — seven profiles, each read-only:

| Profile id | Name | Specialization | Allowed tools | Allowed source types |
|---|---|---|---|---|
| `web-researcher` | Web Researcher | Public web + primary sources | `web.search`, `web.fetch` | PUBLIC_WEB, PRIMARY_OFFICIAL_SOURCE |
| `internal-knowledge-analyst` | Internal Knowledge Analyst | Authorized knowledge bases | `rag.retrieve` | KNOWLEDGE_BASE, PRIVATE_DOCUMENT |
| `document-analyst` | Document Analyst | Uploaded documents (sections + citations) | `rag.retrieve`, `ocr.extract` | PRIVATE_DOCUMENT, MULTIMODAL_SOURCE |
| `connected-data-analyst` | Connected Data Analyst | Authorized connected apps | `connected.search` | CONNECTED_EMAIL/FILE/MESSAGE/RECORD |
| `comparison-analyst` | Comparison Analyst | Compare collected evidence | `compare` | *(none — operates on existing evidence)* |
| `fact-checker` | Fact Checker | Verify claims against evidence | `verify`, `web.search` | PUBLIC_WEB, PRIMARY_OFFICIAL_SOURCE |
| `synthesis-analyst` | Synthesis Analyst | Synthesize verified findings | `synthesize` | *(none — operates on verified findings)* |

The retrieval profiles gather evidence; the **comparison / fact-checker / synthesis**
profiles operate on evidence and findings already in the session (no new source
budget), so verification and synthesis never open fresh research areas.

## Tool minimization + read-only, enforced structurally

Every profile tool is a **read** operation:
`web.search · web.fetch · rag.retrieve · connected.search · vision.analyze ·
ocr.extract · compare · verify · synthesize`. There is intentionally **no** send /
create / update / delete / post / write / email tool anywhere in the registry.

This is enforced, not merely intended:

- `profileIsReadOnly(profile)` structurally asserts no tool name matches
  `/send|create|update|delete|post|write|email/i`.
- `runSpecialistTask` **refuses** a profile that is unknown or not read-only — it logs a
  `research.blocked` security event (`reason: invalid_or_write_profile`) and returns
  zero evidence/findings rather than executing.
- A specialist uses only its **task's** tools/source types intersected with its
  profile's allowlist (`scope ∩ profile`) — it can never touch a source type outside
  that intersection.

## No credentials, no independent permissions

A specialist never holds a credential. All retrieval goes through the
`ResearchSourceProvider`, which delegates to the existing Phase 8–10 tenant-isolated
web / RAG / connected retrieval; those layers load server-only credentials and enforce
the session's tenant scope. The specialist passes the session's `userId` /
`organizationId` / `knowledgeBaseIds` / `connectionIds` through — it cannot substitute
another tenant's ids, and private content is never sent to public web search. See
[`RESEARCH_SECURITY.md`](./RESEARCH_SECURITY.md).

## Scope filtering & source budgets

Within a task, a specialist retrieves only up to
`min(task.maxSources, profile.maxSources, remainingSessionSourceBudget)` sources, across
only the source types in `task.allowedSourceTypes ∩ profile.allowedSourceTypes`. It
stores deduplicated evidence and emits one evidence-backed finding per stored source.
It cannot exceed the session's total source budget, and it cannot continue past the
orchestrator's deadline / agent-run limits.

## The fact-checker & synthesis-analyst

- **Fact Checker** (`verify`, `web.search`) — checks claims already surfaced against the
  collected evidence and flags conflicts; its scope explicitly forbids opening new
  research areas. In Phase 15 the verification stage runs `detectConflicts` over the
  session's evidence (`conflict.ts`).
- **Synthesis Analyst** (`synthesize`) — operates **only** on verified findings +
  evidence and must not invent facts; it produces the final grounded report
  (`synthesis.ts`), with every citation validated against the evidence store and
  unresolved conflicts surfaced as uncertainties. See
  [`RESEARCH_CITATIONS.md`](./RESEARCH_CITATIONS.md).

## Adding a profile

A new specialist is **configuration**: add a `SpecialistProfile` to
`SPECIALIST_PROFILES` (id, specialization, a **minimized read-only** tool allowlist, the
source types it may touch, step/source caps). Because `profileIsReadOnly` and the
executor's refusal are structural, a profile that accidentally lists a write-shaped tool
is rejected at runtime rather than silently trusted. No new profile grants credentials
or permissions — authority always comes from the layers above, never from the profile.
A profile can be disabled operationally via `RESEARCH_DISABLED_PROFILES` (comma list,
e.g. `RESEARCH_DISABLED_PROFILES="fact-checker"`); the orchestrator skips any task
assigned to a disabled or unknown profile.
