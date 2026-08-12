import { and, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { webSearchRequests } from '@/server/db/schema';
import { getWebSearchProvider } from './search-provider';
import { webSearchEnabledGlobally, webSearchConfig } from './config';

/** Admin web-search overview — operational metadata only. Never API keys. */
export async function webSearchOverview() {
  const db = getDb();
  const now = new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const agg = async (since: Date) => {
    const [row] = await db
      .select({
        searches: sql<number>`count(*)::int`,
        pages: sql<number>`coalesce(sum(${webSearchRequests.pagesFetched}),0)::int`,
        failures: sql<number>`coalesce(sum(${webSearchRequests.fetchFailures}),0)::int`,
        errors: sql<number>`count(*) filter (where ${webSearchRequests.status} = 'error')::int`,
        avgSearchMs: sql<number>`coalesce(avg(${webSearchRequests.searchLatencyMs}),0)::int`,
        avgFetchMs: sql<number>`coalesce(avg(${webSearchRequests.fetchLatencyMs}),0)::int`,
      })
      .from(webSearchRequests)
      .where(gte(webSearchRequests.createdAt, since));
    return row;
  };
  const [day, month] = await Promise.all([agg(dayStart), agg(monthStart)]);
  const provider = getWebSearchProvider();
  const health = await provider.health();

  return {
    enabled: webSearchEnabledGlobally(),
    provider: provider.name,
    providerHealth: health,
    config: webSearchConfig(),
    today: { searches: day?.searches ?? 0, pagesFetched: day?.pages ?? 0, fetchFailures: day?.failures ?? 0, errors: day?.errors ?? 0, avgSearchMs: day?.avgSearchMs ?? 0, avgFetchMs: day?.avgFetchMs ?? 0 },
    month: { searches: month?.searches ?? 0, pagesFetched: month?.pages ?? 0, fetchFailures: month?.failures ?? 0, errors: month?.errors ?? 0 },
  };
}
