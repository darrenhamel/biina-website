import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { validateProductionConfig } from '@/server/config/production';

/**
 * Public liveness / readiness check. Component status only — NEVER secrets and
 * NO infra probing. Deep, DB-routing-aware AI diagnostics (provider, model,
 * health) live behind the admin-only /api/ai/health.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = { app: 'ok', database: 'error' };

  try {
    await getDb().execute(sql`select 1`);
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  // In production, a critical configuration problem fails readiness — WITHOUT leaking
  // which variable is at fault (the admin-only /api/admin/production-readiness has detail).
  const cfg = validateProductionConfig();
  checks.config = cfg.production && !cfg.ok ? 'error' : 'ok';

  const healthy = Object.values(checks).every((v) => v === 'ok');
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks: { ...checks, aiGateway: 'ok' },
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
