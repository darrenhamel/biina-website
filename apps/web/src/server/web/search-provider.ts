import { createHash } from 'node:crypto';
import { webSearchProviderName } from './config';

/**
 * Provider-independent web search. The app calls WebSearchService, which calls a
 * WebSearchProvider — vendor result shapes never spread through the codebase.
 *
 * `mock` (default): deterministic canned results (no key, no network) so the full
 * pipeline runs and tests reproducibly. `generic`: a fetch-based adapter for an
 * OpenAI-style JSON search API (Brave/Tavily/Bing-compatible via env), the
 * production path; not exercised here without a key.
 */

export type Freshness = 'any' | 'day' | 'week' | 'month' | 'year';

export interface SearchParams {
  query: string;
  maxResults: number;
  language?: string;
  country?: string;
  freshness?: Freshness;
  safeSearch: 'off' | 'moderate' | 'strict';
  signal?: AbortSignal;
}

export interface NormalizedResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
  domain: string;
  rank: number;
}

export interface WebSearchProvider {
  readonly name: string;
  search(params: SearchParams): Promise<NormalizedResult[]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

const domainOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** Deterministic mock — results depend only on the query (reproducible). */
export class MockWebSearchProvider implements WebSearchProvider {
  readonly name = 'mock';
  async search(params: SearchParams): Promise<NormalizedResult[]> {
    const seed = createHash('md5').update(params.query.toLowerCase()).digest('hex');
    const n = Math.min(params.maxResults, 5);
    const results: NormalizedResult[] = [];
    for (let i = 0; i < n; i++) {
      const host = `example${(parseInt(seed[i], 16) % 3) + 1}.org`;
      const url = `https://${host}/article/${seed.slice(i * 4, i * 4 + 8)}`;
      results.push({
        title: `${params.query} — reference ${i + 1}`,
        url,
        snippet: `A public source discussing ${params.query}. This mock snippet stands in for a real search result.`,
        publishedAt: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
        domain: host,
        rank: i + 1,
      });
    }
    // Insert one duplicate (same canonical) to exercise dedupe.
    if (results.length > 1) results.push({ ...results[0], title: results[0].title + ' (mirror)', rank: n + 1 });
    return results;
  }
  async health() { return { ok: true, detail: 'mock' }; }
}

/** Generic fetch-based adapter (production template). Not used without a key. */
export class GenericJsonSearchProvider implements WebSearchProvider {
  readonly name = 'generic';
  async search(params: SearchParams): Promise<NormalizedResult[]> {
    const url = process.env.WEB_SEARCH_API_URL;
    const key = process.env.WEB_SEARCH_API_KEY;
    if (!url || !key) throw new Error('web search provider not configured');
    const res = await fetch(url, {
      method: 'POST',
      signal: params.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: params.query, max_results: params.maxResults, freshness: params.freshness, safesearch: params.safeSearch, language: params.language, country: params.country }),
    });
    if (!res.ok) throw new Error(`search failed (${res.status})`);
    const json = (await res.json()) as { results?: Array<{ title?: string; url: string; snippet?: string; content?: string; published_date?: string }> };
    return (json.results ?? []).map((r, i) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: r.snippet ?? r.content ?? '',
      publishedAt: r.published_date ?? null,
      domain: domainOf(r.url),
      rank: i + 1,
    }));
  }
  async health() {
    return { ok: Boolean(process.env.WEB_SEARCH_API_URL && process.env.WEB_SEARCH_API_KEY), detail: process.env.WEB_SEARCH_API_URL ? undefined : 'not configured' };
  }
}

let cached: WebSearchProvider | null = null;
let override: WebSearchProvider | null = null;
export function getWebSearchProvider(): WebSearchProvider {
  if (override) return override;
  if (cached) return cached;
  switch (webSearchProviderName()) {
    case 'generic':
      cached = new GenericJsonSearchProvider();
      break;
    case 'mock':
    default:
      cached = new MockWebSearchProvider();
  }
  return cached;
}
export function setWebSearchProvider(p: WebSearchProvider | null): void {
  override = p;
  cached = null;
}
