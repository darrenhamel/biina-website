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

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      ai: { provider: cfg.defaultProvider, model: cfg.defaultModel },
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
