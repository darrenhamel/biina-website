import { randomUUID } from 'node:crypto';
import { getDb } from '@/server/db';
import { webSearchRequests } from '@/server/db/schema';
import type { Plan } from '@/server/db/schema';
import { logger } from '@/lib/logger';
import { badRequest, forbidden } from '@/lib/errors';
import { getWebSearchProvider, type NormalizedResult, type Freshness } from './search-provider';
import { getWebPageFetcher } from './fetcher';
import { extractWebContent } from './extractor';
import { buildWebGrounding, webInstructions, type GroundedWebSource, type WebCitation } from './grounding';
import { webSearchEnabledGlobally, webSearchConfig, fetchConfig } from './config';
import { webSearchUsage, assertWebSearchQuota } from './quota';

/**
 * WebSearchService — the ONE controlled entry to live web grounding. Handles
 * authorization, plan entitlement + quota, query validation, provider search,
 * dedupe, bounded source selection + safe fetching (SSRF-guarded, concurrency +
 * time-budget limited), extraction, grounding, metering, and a request record.
 *
 * PRIVACY: the query sent to the search provider is the USER'S question only —
 * never private document text, never whole conversations (see WEB_SECURITY.md).
 */

export interface WebGroundInput {
  query: string;
  userId: string;
  organizationId: string | null;
  plan: Plan;
  conversationId?: string | null;
  requestId?: string | null;
  freshness?: Freshness;
  signal?: AbortSignal;
}

export interface WebGroundResult {
  instructions: string;
  contextBlock: string;
  citations: WebCitation[];
  hasEvidence: boolean;
  searched: boolean;
  resultCount: number;
  pagesFetched: number;
}

/** Bounded-concurrency map. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function dedupe(results: NormalizedResult[]): NormalizedResult[] {
  const seen = new Set<string>();
  const out: NormalizedResult[] = [];
  for (const r of results) {
    let canon = r.url;
    try { const u = new URL(r.url); canon = `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`; } catch { /* keep raw */ }
    const key = canon.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export async function groundWithWeb(input: WebGroundInput): Promise<WebGroundResult> {
  // Entitlement: global switch + plan.
  if (!webSearchEnabledGlobally() || !input.plan.webSearchEnabled) {
    throw forbidden('Web search is not available on your plan.');
  }
  const query = input.query.trim();
  if (query.length < 2) throw badRequest('Search query is too short.');
  if (query.length > 400) throw badRequest('Search query is too long.');

  const now = new Date();
  assertWebSearchQuota(input.plan, await webSearchUsage(input.userId, now));

  const cfg = webSearchConfig();
  const fcfg = fetchConfig();
  const maxPages = Math.min(cfg.maxPages, input.plan.maxSourcesPerRequest ?? cfg.maxPages);
  const provider = getWebSearchProvider();
  const fetcher = getWebPageFetcher();

  // Overall time budget so one slow site can't block the answer.
  const budget = AbortSignal.timeout(fcfg.totalBudgetMs);
  const signal = input.signal ? AbortSignal.any([input.signal, budget]) : budget;

  const searchStart = Date.now();
  let results: NormalizedResult[] = [];
  let status: 'ok' | 'no_results' | 'error' = 'ok';
  try {
    results = dedupe(
      await provider.search({
        query,
        maxResults: cfg.maxResults,
        language: cfg.defaultLanguage,
        country: cfg.defaultCountry,
        freshness: input.freshness,
        safeSearch: cfg.safeMode,
        signal,
      }),
    );
  } catch (err) {
    status = 'error';
    logger.warn('web.search.failed', { error: String(err) });
  }
  const searchLatencyMs = Date.now() - searchStart;
  if (results.length === 0 && status === 'ok') status = 'no_results';

  // Fetch a bounded number of top sources; snippet-fallback on fetch failure.
  const selected = results.slice(0, maxPages);
  const fetchStart = Date.now();
  let bytesFetched = 0;
  let fetchFailures = 0;
  const retrievedAt = now.toISOString();

  const sources: GroundedWebSource[] = (
    await pool(selected, fcfg.concurrency, async (r): Promise<GroundedWebSource | null> => {
      try {
        const page = await fetcher.fetch(r.url, signal);
        bytesFetched += page.body.length;
        const extracted = await extractWebContent(page);
        const text = extracted.text || r.snippet;
        return {
          sourceId: randomUUID(),
          title: extracted.title ?? r.title,
          url: page.finalUrl,
          domain: extracted.domain || r.domain,
          publishedAt: extracted.publishedAt ?? r.publishedAt ?? null,
          retrievedAt,
          text,
          kind: extracted.text ? 'FETCHED_PAGE' : 'SEARCH_SNIPPET',
        };
      } catch (e) {
        fetchFailures += 1;
        logger.info('web.fetch.failed', { url: r.url, error: String((e as Error)?.message ?? e) });
        // Fall back to the provider snippet, clearly marked as weaker evidence.
        return { sourceId: randomUUID(), title: r.title, url: r.url, domain: r.domain, publishedAt: r.publishedAt ?? null, retrievedAt, text: r.snippet, kind: 'SEARCH_SNIPPET' };
      }
    })
  ).filter((s): s is GroundedWebSource => s !== null && Boolean(s.text));

  const fetchLatencyMs = Date.now() - fetchStart;
  const built = buildWebGrounding(sources, { maxContextTokens: 2400 });

  // Record (metadata + query; retention/redaction policy documented).
  try {
    await getDb().insert(webSearchRequests).values({
      requestId: input.requestId ?? null,
      userId: input.userId,
      organizationId: input.organizationId,
      conversationId: input.conversationId ?? null,
      query: query.slice(0, 500),
      provider: provider.name,
      mode: 'USER_SELECTED',
      resultCount: results.length,
      pagesFetched: sources.filter((s) => s.kind === 'FETCHED_PAGE').length,
      bytesFetched,
      fetchFailures,
      status,
      searchLatencyMs,
      fetchLatencyMs,
    });
  } catch (e) {
    logger.warn('web.record.failed', { error: String(e) });
  }

  return {
    instructions: webInstructions(built.hasEvidence, now),
    contextBlock: built.contextBlock,
    citations: built.citations,
    hasEvidence: built.hasEvidence,
    searched: status !== 'error',
    resultCount: results.length,
    pagesFetched: sources.filter((s) => s.kind === 'FETCHED_PAGE').length,
  };
}
