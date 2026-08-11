import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db';

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
