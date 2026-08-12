# BIINA.ai — Research Evidence & Findings

How advanced research turns retrieved content into **traceable evidence** and
**verifiable findings** — with provenance, deduplication, primary-source priority,
conflict detection, and explicit uncertainty. The rule throughout: **claims are backed
by real evidence or they do not appear.** Code:
`apps/web/src/server/research/evidence.ts`, `sources.ts`, `conflict.ts`,
`synthesis.ts`. Companion: [`RESEARCH_CITATIONS.md`](./RESEARCH_CITATIONS.md),
[`ADVANCED_RESEARCH.md`](./ADVANCED_RESEARCH.md).

## The evidence chain

```
Final Claim ─▶ Finding ─▶ Evidence ─▶ Source
```

Every claim in the report traces back through a finding to a piece of evidence to an
authorized source. Nothing skips a link. See
[`RESEARCH_CITATIONS.md`](./RESEARCH_CITATIONS.md) for how the chain is validated.

## Source-type model

Evidence is tagged with a `research_source_type` describing where it came from and how
sensitive it is (`profiles.ts`, schema):

- `PUBLIC_WEB`, `PRIMARY_OFFICIAL_SOURCE` — public web and primary/official sources.
- `PRIVATE_DOCUMENT`, `KNOWLEDGE_BASE` — the user's/org's authorized knowledge.
- `CONNECTED_EMAIL`, `CONNECTED_FILE`, `CONNECTED_MESSAGE`, `CONNECTED_RECORD` —
  authorized connected apps.
- `MULTIMODAL_SOURCE` — image/OCR-derived content.

A task may only touch the source types in its scope ∩ its profile's allowlist, and
**private content is never sent to public web search.** All retrieval flows through the
`ResearchSourceProvider` (`sources.ts`), which delegates to the existing Phase 8–10
tenant-isolated web / RAG / connected layers — so every authorization, provenance, and
prompt-injection boundary is inherited, not re-implemented.

## Evidence model — provenance + quality, not a "truth score"

Each `research_evidence` row records **provenance**, never a whole source document:

- `sourceType`, `sourceId` (url / documentId / connector externalId), `title`,
  `sourceReference`, a bounded `excerpt` (≤4000 chars).
- `publishedAt` (source date, when known) and `retrievedAt` (when BIINA fetched it).
- `relevanceScore` — a retrieval relevance signal, when the layer provides one.
- `qualityMetadata` — **safe descriptive metadata only**: `primarySource` /
  `officialSource` / `domain` / `date`. This is deliberately **not** a misleading
  "truth score"; BIINA never claims a machine verdict on whether a source is *true*, only
  where it came from and what kind of source it is.
- `contentHash` — a short sha256 over `sourceId + normalized excerpt`, used for dedup.

## Findings & claim–evidence linking

A `research_finding` links a `claim` to the `evidenceIds` that support it, with a
`confidence` (0–1) and a `status`. Linking is **validated on write**
(`storeFinding` → `validateEvidenceIds`): only ids that are **real evidence rows in this
session** are kept. A finding with a substantive claim that ends up citing **no** valid
evidence is **rejected** (`return null`) — an unsupported major claim is dropped rather
than stored. Each retrieval specialist emits one evidence-backed finding per stored
source (claim drawn from the source's title/excerpt), with confidence nudged higher for
primary sources.

## Deduplication

Evidence is deduplicated by `contentHash` **within the session** (`storeEvidence`): a
near-duplicate excerpt from the same source id is skipped, so canonical / mirrored /
syndicated copies of the same content don't inflate the source count or double-weight a
claim. Synthesis additionally consolidates identical claims (keeping the highest
confidence and the union of citations).

## Source diversity & primary-source priority

Because dedup collapses mirrors and syndication, distinct sources — not copies — drive
the evidence count. Quality metadata marks `primarySource` / `officialSource`, and
those sources are given more weight (higher default finding confidence); the
verification stage prefers authoritative/current sources **only when justified**, and
always keeps the disagreement visible rather than discarding the minority source.

## Conflict detection

`detectConflicts` (`conflict.ts`) surfaces disagreement between sources rather than
silently resolving it:

- It extracts a comparable **numeric signal** from each excerpt (a topic keyword + a
  value, normalizing units like million/billion/k/%).
- Two evidence items that **share a topic keyword** but carry **materially different
  values** (≥10% relative difference) are recorded as a `research_conflict` (status
  `OPEN`) referencing both evidence ids.
- **Only** the findings that cite either conflicting evidence item are flagged
  `CONFLICTING` — unrelated findings are untouched.
- A `research.conflict_detected` security event records the count (metadata only).

Numeric signal detection is the Phase 15 heuristic; richer semantic conflict detection
is readiness. Conflicts are surfaced, never auto-resolved.

## Claim verification statuses

A `research_finding.status` (`finding_status`) is one of:

- **SUPPORTED** — backed by valid evidence.
- **PARTIALLY_SUPPORTED** — partially backed.
- **CONFLICTING** — its evidence disagrees with other evidence (set by conflict detection).
- **UNVERIFIED** — not yet verified (the schema default; the only status permitted to
  carry no valid evidence, and such findings are excluded from the final report).

## Freshness & temporal handling

Evidence carries both `publishedAt` (when the source is dated) and `retrievedAt` (when
BIINA collected it), so the report can reason about recency and the source panel can
show retrieval dates. The numeric-conflict heuristic gives a first-order way to notice
stale-vs-current disagreement; full temporal reasoning / recency ranking is readiness.

## Synthesis grounding

`synthesize` (`synthesis.ts`) builds the report **strictly** from findings backed by
real evidence — it re-validates every finding's evidence ids, drops any finding with no
valid citation, consolidates duplicate claims, lists unresolved conflicts as explicit
`uncertainties`, and never manufactures a consensus. If nothing is sufficiently
supported, the report says so plainly. See
[`RESEARCH_CITATIONS.md`](./RESEARCH_CITATIONS.md).
