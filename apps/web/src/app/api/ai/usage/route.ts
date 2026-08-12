import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { getPlan } from '@/server/ai/plans';
import { userUsageWindows } from '@/server/ai/ledger';
import { unauthorized, handleError } from '@/lib/api';

/**
 * GET /api/ai/usage — the signed-in user's plan + usage. Consumer-safe:
 * requests/tokens and remaining allowance only. NEVER infrastructure cost.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function nextUtcMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}
function remaining(limit: number | null, used: number): number | null {
  return limit == null ? null : Math.max(0, limit - used);
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const now = new Date();
    const plan = await getPlan(user.plan);
    const agg = await userUsageWindows(user.id, now);

    return NextResponse.json({
      plan: { slug: plan.slug, displayName: plan.displayName },
      month: {
        requests: agg.monthRequests,
        tokens: agg.monthTokens,
        requestLimit: plan.monthlyRequestLimit,
        tokenLimit: plan.monthlyTokenLimit,
        remainingRequests: remaining(plan.monthlyRequestLimit, agg.monthRequests),
        remainingTokens: remaining(plan.monthlyTokenLimit, agg.monthTokens),
      },
      day: {
        requests: agg.dayRequests,
        tokens: agg.dayTokens,
        requestLimit: plan.dailyRequestLimit,
        tokenLimit: plan.dailyTokenLimit,
        remainingRequests: remaining(plan.dailyRequestLimit, agg.dayRequests),
        remainingTokens: remaining(plan.dailyTokenLimit, agg.dayTokens),
      },
      resetsAt: nextUtcMonth(now),
    });
  } catch (err) {
    return handleError(err, 'ai.usage');
  }
}
