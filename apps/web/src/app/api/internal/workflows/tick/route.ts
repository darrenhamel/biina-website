import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { handleError, ok } from '@/lib/api';
import { logger } from '@/lib/logger';
import { tick } from '@/server/workflows/scheduler';

/**
 * POST /api/internal/workflows/tick — the WORKER boundary. An external cron / durable
 * worker calls this (e.g. once per minute) to advance the DB-authoritative scheduler.
 *
 * SECURITY: authenticated with a shared secret (WORKFLOW_TICK_SECRET) compared in
 * constant time. It takes NO user-supplied job payload — the worker loads workflow
 * configuration from the database by trusted id. Without the secret set, the endpoint
 * is disabled (503) so it can never be called anonymously.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest): boolean {
  const secret = process.env.WORKFLOW_TICK_SECRET;
  if (!secret) return false;
  const provided = req.headers.get('x-workflow-tick-secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.WORKFLOW_TICK_SECRET) return NextResponse.json({ error: 'Scheduler tick is not configured.' }, { status: 503 });
    if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const workerId = (req.headers.get('x-worker-id') ?? 'tick').slice(0, 40);
    const result = await tick(workerId);
    logger.info('workflow.tick', { workerId, claimed: result.claimed, recovered: result.recovered, duplicates: result.skippedDuplicates });
    return ok(result);
  } catch (err) {
    return handleError(err, 'workflows.tick');
  }
}
