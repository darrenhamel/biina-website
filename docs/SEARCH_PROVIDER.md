# BIINA.ai — Adding a Search Provider

Web search is **provider-independent by design**, the same way the AI Gateway and
the billing layer are. The pipeline (search → select → fetch → extract → ground →
cite), the SSRF and injection defenses, the quotas, and the citations are all
provider-agnostic — swapping in a real search vendor is an **adapter + env**
change with no route, DB, or frontend change. Code:
`apps/web/src/server/web/search-provider.ts`; companion: `WEB_SEARCH.md`.

## The interface

A provider implements `WebSearchProvider`:

```ts
interface WebSearchProvider {
  readonly name: string;
  search(query: string, opts: SearchOptions): Promise<WebSearchResult[]>;
  health(): Promise<ProviderHealth>;
}
```

`search()` returns **normalized** results — the rest of BIINA never sees a
vendor's raw payload:

```ts
interface WebSearchResult {
  title: string;
  url: string;          // must be an http/https public URL — SSRF-validated before fetch
  snippet: string;
  domain: string;
  rank: number;
  publishedAt?: string; // when the vendor supplies it
}
```

`SearchOptions` carries `maxResults`, `language`, `country`, `safeMode`, and an
optional `freshness` window — mapped to whatever query params the vendor uses.

## Built-in providers

| Provider | When | Notes |
|---|---|---|
| `MockWebSearchProvider` | **default** | deterministic, no key, no network; emits a duplicate to exercise dedupe. Runs and tests the whole pipeline offline. |
| `GenericJsonSearchProvider` | production | fetch-based adapter for a Brave/Tavily/Bing-style JSON API. The real path — not exercised without a key. |

`GenericJsonSearchProvider` is a thin `fetch` client: it calls
`WEB_SEARCH_API_URL` with the query + options, sends the key as a header, and maps
the JSON response into `WebSearchResult[]`. Most commercial search APIs fit this
shape; a vendor whose response differs materially gets its own small adapter
implementing the same interface.

## Configuring a real provider

1. **Choose the adapter.** For a Brave/Tavily/Bing-style JSON API, set
   `WEB_SEARCH_PROVIDER=generic` — no code needed. For a materially different API,
   add `apps/web/src/server/web/providers/<name>.ts` implementing
   `WebSearchProvider` and a factory case.
2. **Set env** (server-side only, never the browser, never git):

   | Variable | Value |
   |---|---|
   | `WEB_SEARCH_ENABLED` | `true` |
   | `WEB_SEARCH_PROVIDER` | `generic` (or your adapter name) |
   | `WEB_SEARCH_API_URL` | the vendor search endpoint |
   | `WEB_SEARCH_API_KEY` | the vendor key |

3. **Tune limits** — `WEB_SEARCH_MAX_RESULTS`, `WEB_MAX_PAGES_FETCHED`,
   `WEB_MAX_QUERIES`, and the fetch/budget knobs (see `WEB_SEARCH.md`).
4. **Verify** via the admin overview (`admin.ts`): provider name + **health**
   should read OK, and a test search should return results.

## Required credentials

Only `WEB_SEARCH_API_URL` + `WEB_SEARCH_API_KEY`. Both stay **server-side and are
never logged** (`WEB_SECURITY.md`). Live search is off by default and is **never
inferred from the presence of a key** — `WEB_SEARCH_ENABLED` must be explicitly
set.

## Cost accounting readiness

`web_search_requests` records per-request counts (results, pages fetched, bytes,
failures) and latencies, so **per-search / per-1000-search cost accounting** can
be layered on the same way Phase 5 meters AI usage — cost-per-search and
cost-per-1000 are **configurable placeholders**. BIINA does **not** ship invented
vendor prices; set real numbers from your contract when you wire cost in. Failed
searches don't count against quota.

## Health checks

`health()` lets the admin overview report provider reachability without exposing
the key. A `generic` provider health-checks by pinging its endpoint; the `mock`
provider is always healthy. A failing health check surfaces to admins and does not
silently degrade user chats — a non-quota search failure answers **without web**
(see `WEB_GROUNDING.md`).

## Provider independence — the invariant

The chat contract (`POST /api/ai/chat`), the answer modes, the citation model, and
the UI are **identical** regardless of which search vendor is configured. Changing
vendors, or running fully offline on `mock`, never changes what the frontend sees
— exactly the decoupling the gateway and billing layers already give BIINA.
