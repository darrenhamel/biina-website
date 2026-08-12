/**
 * Web-search / grounding configuration (env-driven, non-secret knobs). The
 * provider API key is server-side only and never exposed. Web search is OFF by
 * default; per-plan entitlements gate access even when enabled globally.
 */

export function webSearchEnabledGlobally(): boolean {
  return process.env.WEB_SEARCH_ENABLED === 'true';
}
export function webSearchProviderName(): string {
  return process.env.WEB_SEARCH_PROVIDER || 'mock';
}
export function webSearchConfigured(): boolean {
  // The mock provider needs no key; real providers require one.
  return webSearchProviderName() === 'mock' || Boolean(process.env.WEB_SEARCH_API_KEY);
}

export const webSearchConfig = () => ({
  maxResults: clampInt(process.env.WEB_SEARCH_MAX_RESULTS, 8, 1, 20),
  maxPages: clampInt(process.env.WEB_MAX_PAGES_FETCHED, 4, 1, 8),
  defaultLanguage: process.env.WEB_SEARCH_DEFAULT_LANGUAGE || 'en',
  defaultCountry: process.env.WEB_SEARCH_DEFAULT_COUNTRY || undefined,
  safeMode: (process.env.WEB_SEARCH_DEFAULT_SAFE_MODE || 'strict') as 'off' | 'moderate' | 'strict',
  maxQueries: clampInt(process.env.WEB_MAX_QUERIES, 1, 1, 3), // bounded fan-out (no runaway loops)
});

export const fetchConfig = () => ({
  maxBytes: clampInt(process.env.WEB_FETCH_MAX_BYTES, 2_000_000, 10_000, 10_000_000),
  maxRedirects: clampInt(process.env.WEB_FETCH_MAX_REDIRECTS, 3, 0, 5),
  timeoutMs: clampInt(process.env.WEB_FETCH_TIMEOUT_MS, 8000, 1000, 20_000),
  totalBudgetMs: clampInt(process.env.WEB_GROUNDING_BUDGET_MS, 20_000, 3000, 60_000),
  concurrency: clampInt(process.env.WEB_FETCH_CONCURRENCY, 3, 1, 6),
  userAgent: process.env.WEB_FETCH_USER_AGENT || 'BIINA-WebGrounding/1.0 (+https://biina.ai/bot)',
});

/** Trusted current date/time for live-info answers (never the LLM's cutoff). */
export function currentDateContext(now: Date = new Date()): string {
  return `The current date is ${now.toISOString().slice(0, 10)} (UTC).`;
}

function clampInt(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
}
