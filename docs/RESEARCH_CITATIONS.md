# BIINA.ai — Research Citations

How advanced research keeps its report **honestly cited**: every claim traces to real,
authorized evidence, every citation is validated against the evidence store, and a
**model-invented citation is rejected and never displayed.** This extends the Phase 9
[`CITATIONS.md`](./CITATIONS.md) posture to the multi-task research pipeline. Code:
`apps/web/src/server/research/evidence.ts`, `synthesis.ts`. Companion:
[`RESEARCH_EVIDENCE.md`](./RESEARCH_EVIDENCE.md),
[`ADVANCED_RESEARCH.md`](./ADVANCED_RESEARCH.md).

## Citation traceability

```
Final Claim ─▶ Finding ─▶ Evidence ─▶ Source
```

The report's `citationIds` reference `research_evidence` rows; each evidence row carries
its provenance (`sourceType`, `sourceId`, `title`, `sourceReference`, `publishedAt`,
`retrievedAt`, `qualityMetadata`). A reader can follow any claim to the finding that
asserts it, to the evidence that supports it, to the source it came from — no link is
skipped.

## Citation validation

Citations are validated **twice**, structurally:

1. **At finding time** — `storeFinding` calls `validateEvidenceIds`, keeping only ids
   that are **real evidence rows in this session**. A substantive claim that cites no
   valid evidence is rejected outright (the finding is not stored).
2. **At synthesis time** — `synthesize` re-runs `validateEvidenceIds` on every
   finding's `evidenceIds`; a finding whose citations don't resolve to real evidence is
   **excluded from the report**. Only the surviving ids populate the result's
   `citationIds`.

`validateEvidenceIds` also shape-checks each id (a uuid) and scopes the lookup to
`researchSessionId = this session`, so an id from another session or another tenant can
never satisfy a citation.

## Fabricated-citation rejection

If the model's prose references a citation id that is not a real evidence row in this
session, that id is **dropped and never displayed** — there is no path for an invented
source, a hallucinated URL, or a cross-session id to appear as a citation. A claim that
depends only on fabricated citations does not survive into the report. This is the core
anti-hallucination guarantee of research citations: **a citation you see resolves to
evidence BIINA actually retrieved under your authorization.**

## Citation persistence & health

Evidence is stored with durable provenance metadata plus `retrievedAt`, so a citation
remains meaningful even if the underlying page later changes or disappears — BIINA
retains the `title`, `sourceReference`, `sourceType`, the source date, and the
retrieval date rather than depending on the live page. (Snapshotting full source
content is deliberately **not** done — BIINA stores bounded excerpts + provenance, not
whole documents.) A live citation-health checker that re-probes URLs is **readiness**;
the retained metadata + retrieval date is what ships.

## Source-access re-check on later open

Opening a completed run (`GET /api/research/[id]`) re-resolves access through
`resolveResearchAccess` every time — a personal run only for its owner, an org run only
for a verified member of that org's active workspace (else null → 404). The source
panel returns **provenance metadata** (title, source type, reference, retrieval/publish
dates, quality) — private source **content** stays behind its own access-controlled
retrieval path and is not copied wholesale into the report. So a citation to a private
document is only as reachable as the viewer's own permissions allow; a citation never
becomes a backdoor to content the viewer couldn't otherwise open.

## No misleading confidence

Citations carry provenance and a retrieval relevance signal, not a machine "truth
score" (see [`RESEARCH_EVIDENCE.md`](./RESEARCH_EVIDENCE.md)). Where sources disagree,
the citation stays attached to a `CONFLICTING` finding and the report surfaces the
disagreement as an explicit uncertainty rather than presenting one cited number as
settled fact.
