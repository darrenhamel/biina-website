import { NextResponse } from 'next/server';
import { getConfig, providerDiagnostics } from '@biina/ai-gateway';
import { getCurrentUser } from '@/server/auth/session';
import { unauthorized, forbidden, handleError } from '@/lib/api';

/**
 * GET /api/ai/health — ADMIN-only AI diagnostics.
 *
 * Reports the normalized status of the AI stack and, where the provider can
 * enumerate models, whether the configured model actually exists. This is the
 * model-discovery surface; it is admin-gated so infrastructure detail is not
 * exposed publicly. Never returns secrets (base URLs/keys are omitted).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    if (user.role !== 'ADMIN') return forbidden('Administrator access required');

    const cfg = getConfig();
    const diag = await providerDiagnostics();

    const configuredModelOk =
      diag.configuredModelPresent === undefined ? 'unknown' : diag.configuredModelPresent ? 'ok' : 'missing';

    const status = {
      application: 'ok' as const,
      aiGateway: 'ok' as const,
      provider: diag.provider,
      providerConnection: diag.health.ok ? ('ok' as const) : ('error' as const),
      configuredModel: configuredModelOk,
      defaultProvider: cfg.defaultProvider,
      // Non-secret: which logical/vendor model the gateway resolved.
      model: diag.configuredModel,
      // Only names, no infra endpoints.
      availableModels: diag.availableModels ?? [],
      detail: diag.health.detail,
      latencyMs: diag.health.latencyMs,
      time: new Date().toISOString(),
    };

    const healthy = diag.health.ok && configuredModelOk !== 'missing';
    return NextResponse.json(status, { status: healthy ? 200 : 503 });
  } catch (err) {
    return handleError(err, 'ai.health');
  }
}
