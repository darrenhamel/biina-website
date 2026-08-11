import { NextResponse } from 'next/server';
import { getProvider } from '@biina/ai-gateway';
import { requireAdmin } from '@/server/auth/guards';
import { loadAiConfig } from '@/server/ai/catalog';
import { selectRoute, validateConfig } from '@/server/ai/routing';
import { metricsSnapshot } from '@/server/ai/metrics';
import { handleError } from '@/lib/api';

/**
 * GET /api/ai/health — ADMIN-only AI diagnostics, now DB-routing aware.
 *
 * Resolves the current DEFAULT route, live-probes that provider, and reports
 * config problems + metrics. Never returns secrets (URLs/keys omitted).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const snap = await loadAiConfig(true);
    const problems = validateConfig(snap);

    let route: { biinaModel: string; provider: string; providerModel: string; reason: string } | null = null;
    let providerConnection: 'ok' | 'error' | 'unknown' = 'unknown';
    let configuredModel: 'ok' | 'missing' | 'unknown' = 'unknown';
    let detail: string | undefined;
    let latencyMs: number | undefined;

    try {
      const d = selectRoute({ isAdmin: true }, snap);
      route = { biinaModel: d.biinaModelSlug, provider: d.providerType, providerModel: d.providerModel, reason: d.reason };
      const health = await getProvider(d.providerType).health();
      providerConnection = health.ok ? 'ok' : 'error';
      detail = health.detail;
      latencyMs = health.latencyMs;
      if (health.ok && typeof getProvider(d.providerType).discoverModels === 'function') {
        const available = (await getProvider(d.providerType).discoverModels!()) ?? [];
        if (available.length > 0) {
          configuredModel = available.some(
            (m) => m === d.providerModel || m.split(':')[0] === d.providerModel.split(':')[0],
          )
            ? 'ok'
            : 'missing';
        }
      }
    } catch (err) {
      detail = err instanceof Error ? err.message : 'routing error';
    }

    const healthy = problems.length === 0 && providerConnection !== 'error' && configuredModel !== 'missing';
    return NextResponse.json(
      {
        application: 'ok',
        aiGateway: 'ok',
        defaultRoute: route,
        providerConnection,
        configuredModel,
        detail,
        latencyMs,
        problems,
        metrics: metricsSnapshot(),
        time: new Date().toISOString(),
      },
      { status: healthy ? 200 : 503 },
    );
  } catch (err) {
    return handleError(err, 'ai.health');
  }
}
