import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { getConfig } from '@biina/ai-gateway';

/**
 * Liveness / readiness check. Reports component status only — NEVER secrets.
 * The selected provider/model are safe, non-secret identifiers.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = getConfig();
  const checks: Record<string, 'ok' | 'error'> = { app: 'ok', database: 'error' };

  try {
    await getDb().execute(sql`select 1`);
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');

  // Public endpoint: report component status only, no infra probing or secrets.
  // Deep AI/provider diagnostics live behind the admin-only /api/ai/health.
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks: { ...checks, aiGateway: 'ok' },
      ai: { provider: cfg.defaultProvider },
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
