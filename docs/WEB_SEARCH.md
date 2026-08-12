# BIINA.ai — Web Search

Phase 9 lets a chat be grounded in the **live public web**. The guiding rule
mirrors Phase 8's:

> **Web search is context infrastructure, not a provider.** It never bypasses the
> Phase 4 routing engine or the Phase 5 quotas, and the LLM never makes network
> requests — every fetch passes through BIINA.ai server components.

Companion docs: `WEB_GROUNDING.md`, `WEB_SECURITY.md`, `CITATIONS.md`,
`SEARCH_PROVIDER.md`. Code: `apps/web/src/server/web/`.

## The flow

```
User question → Chat → user opt-in web toggle → WebSearchService
     → WebSearchProvider (search) → dedupe + bounded source selection
     → WebPageFetcher (SSRF-guarded) → WebContentExtractor
     → WebGroundingContextBuilder → model routing → AI Gateway → answer + citations
```

Search runs **inside** the AI service, **before** generation, so entitlement,
quota, and routing all resolve before a single token is produced. Web grounding
reuses Phase 8's citation + injection-framing machinery.

## Provider abstraction (`search-provider.ts`)

`WebSearchProvider` is a two-method interface — `search(query, opts)` and
`health()` — returning a **normalized** result shape independent of any vendor:

| Field | Meaning |
|---|---|
| `title` · `url` · `snippet` | display + evidence text |
| `domain` · `rank` | source host + provider ordering |
| `publishedAt?` | publication date when the provider supplies one |

| Provider | Role |
|---|---|
| `MockWebSearchProvider` | **default** — deterministic, no key, no network; includes a duplicate result to exercise dedupe. Runs the full pipeline anywhere. |
| `GenericJsonSearchProvider` | fetch-based adapter for a Brave/Tavily/Bing-style JSON API via env — the production path, not exercised without a key. |

A factory selects the provider from env; tests can inject one directly. Adding a
real provider is a documented adapter + env change — see `SEARCH_PROVIDER.md`.

## Configuration (`config.ts`)

All knobs are env-driven; secrets are **server-side only**.

| Variable | Purpose |
|---|---|
| `WEB_SEARCH_ENABLED` | master switch — **off by default** |
| `WEB_SEARCH_PROVIDER` | `mock` (default) or `generic` |
| `WEB_SEARCH_API_URL` / `WEB_SEARCH_API_KEY` | provider endpoint + key (never sent to the browser, never logged) |
| `WEB_SEARCH_MAX_RESULTS` | results requested per query |
| `WEB_MAX_PAGES_FETCHED` | cap on pages actually fetched |
| `WEB_MAX_QUERIES` | bounded fan-out (no recursive search loops) |
| `WEB_SEARCH_DEFAULT_LANGUAGE` / `_COUNTRY` / `_SAFE_MODE` | locale + safety defaults |
| `WEB_FETCH_MAX_BYTES` / `_MAX_REDIRECTS` / `_TIMEOUT_MS` / `_CONCURRENCY` | fetch limits |
| `WEB_GROUNDING_BUDGET_MS` | total wall-clock budget for search + fetch |
| `WEB_FETCH_USER_AGENT` | identifiable UA string |

`currentDateContext()` gives the model the **trusted current date**, so freshness
questions are answered from real time, never a training cutoff.

## Query validation & rewriting stance

The query is validated (length, non-empty, UTF-8) before it reaches a provider.
The **query sent to the provider is the user's question only** — never private
document text or whole conversations (see `WEB_SECURITY.md`). BIINA does **not**
auto-rewrite or expand queries today: query expansion / rephrasing is a
configurable future step, kept out to avoid leaking context and to keep behavior
predictable.

## Source selection, dedupe & snippet-vs-page

- **Dedupe** happens twice: at result selection (canonical URL) and again in the
  grounding builder (syndicated copies of the same content).
- **Bounded selection**: BIINA fetches `min(WEB_MAX_PAGES_FETCHED,
  plan.maxSourcesPerRequest)` pages — never the whole result set.
- Fetches run **concurrently** in a pool under the total time budget; a page that
  fails to fetch **falls back to its search snippet** rather than being dropped.
- The grounding layer distinguishes **FETCHED_PAGE** (full extracted text, strong
  evidence) from **SEARCH_SNIPPET** (weaker evidence) so the model weights them
  accordingly.

## Freshness

Freshness relies on **live fetch** — there is no cache layer yet (documented as
future work). The optional `freshness` filter (plan-gated via
`plan.freshnessFiltersEnabled`) narrows results to recent content when the
provider supports it.

## Arabic & multilingual

UTF-8 queries and content are preserved end-to-end and RTL citations render
correctly. Arabic queries are **not** auto-translated — cross-language query
expansion is a configurable future step, not built.

## Known limitations

- Default `mock` provider means no live results locally; the full
  search→select→fetch→extract→ground→cite pipeline, SSRF, injection defense,
  quotas, and citations still run and are tested.
- **Public web only** — no login/paywall bypass, no headless browser (JS-heavy
  pages are flagged, not rendered), no autonomous/recursive search loops.
- No caching layer yet; each request fetches live.
