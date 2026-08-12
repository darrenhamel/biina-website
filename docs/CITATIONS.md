# BIINA.ai — Citations

A **unified citation model** spans private documents (Phase 8) and the live web
(Phase 9), so an answer can cite both kinds of evidence with one consistent
shape. A citation is a **reference to a real source the user is authorized to
see** — never a fabricated pointer to justify a claim. Code:
`apps/web/src/server/web/grounding.ts`, `apps/web/src/server/rag/`; companion:
`RAG_ARCHITECTURE.md`, `WEB_GROUNDING.md`, `WEB_SECURITY.md`.

## Source types

Every cited source carries a `sourceType` that tells the reader (and the model)
how strong the evidence is:

| `sourceType` | Origin | Evidence strength |
|---|---|---|
| `PRIVATE_DOCUMENT` | a chunk from the user's / org's knowledge base | authoritative, private |
| `WEB_PAGE` (FETCHED_PAGE) | full text extracted from a fetched public page | strong |
| `SEARCH_SNIPPET` | a provider snippet where the page couldn't be fetched | weaker |

The model is instructed to weight a snippet below a fetched page, and both below
private documents when they conflict.

## Provenance fields

| Field | Private document | Web source |
|---|---|---|
| identity | `documentId` · `documentName` | `url` · `domain` · `title` |
| location | `page` · `sectionTitle` · `chunkId` | — |
| scope | `knowledgeBaseId` | — |
| freshness | — | `publishedAt?` · retrieved-on timestamp |
| type | `sourceType` | `sourceType` |

## Citation ↔ claim traceability

Each source is injected as a **numbered block** (`SOURCE`/`WEB_SOURCE`), and the
model cites `[n]` matching that number. This keeps a claim traceable to a
specific source rather than to "the web" or "your documents" in the aggregate.
Web-derived claims must carry a `[n]`; the no-fabrication policy forbids inventing
one.

## Citation security

- A web citation URL is **only ever an `http`/`https` public URL** — the same URL
  that passed SSRF validation and was actually fetched.
- **Internal, fetch-proxy, or redirect-intermediate URLs are never surfaced** as
  citations. There is no path by which an SSRF-blocked or internal address becomes
  a clickable source.
- A private-document citation **re-checks authorization on click** — a stale
  citation can't read a document the user no longer has access to.

## Persistence

Citations are stored on the assistant message (`messages.citations`, jsonb — a
Phase 8 field that now also holds web citations with `sourceType: 'web'`). Stored
citations are **references, not bulk text**: identity + location + timestamp, not
the fetched page body or the full document. This mirrors the audit posture —
accounting and provenance are kept separate from content.

## Reopened conversations — "Retrieved on [date]"

The live web changes. A web citation records **when it was retrieved**, so a
reopened conversation shows **"Retrieved on [date]"** rather than implying the
page still says the same thing today. The stored citation is a faithful record of
what the source said at fetch time, not a live mirror — re-running the question
re-fetches and re-cites.

## No fabricated citations

The model may **only** cite sources present in the injected blocks. It never
invents a document, a URL, a page number, or a publication date. When the
evidence is insufficient, the correct behavior is to say so (see the no-evidence
policy in `WEB_GROUNDING.md` and `RAG_ARCHITECTURE.md`) — not to manufacture a
citation that looks authoritative.

## Rendering

Citations are returned to the client via the `X-Biina-Citations` response header
(URL-encoded JSON) alongside the `X-Biina-Answer-Mode` header. RTL/Arabic
citations render correctly; the same numbered scheme works in both directions.
