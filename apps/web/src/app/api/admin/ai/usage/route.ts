import { NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { loadAiConfig } from '@/server/ai/catalog';
import {
  adminSummary,
  breakdownBy,
  topUsers,
  modelEconomics,
  platformSpend,
} from '@/server/ai/ledger';
import { evaluateBudget } from '@/server/ai/budget';
import { budgetThresholds } from '@/server/ai/preflight';
import { handleError } from '@/lib/api';

/** GET /api/admin/ai/usage — usage + cost dashboard data (ADMIN only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if ('response' in auth) return auth.response;
  try {
    const now = new Date();
    const snap = await loadAiConfig();
    const thresholds = budgetThresholds(snap);

    const [summary, byProvider, byModel, byPlan, byPersona, byWorkload, users, models, spend] =
      await Promise.all([
        adminSummary(now),
        breakdownBy('providerType', now),
        breakdownBy('biinaModelSlug', now),
        breakdownBy('plan', now),
        breakdownBy('persona', now),
        breakdownBy('workload', now),
        topUsers(now, 10),
        modelEconomics(now),
        platformSpend(now),
      ]);

    const budget = evaluateBudget(spend, thresholds);

    return NextResponse.json({
      summary,
      spend,
      budget: { ...budget, thresholds: { ...thresholds } },
      breakdowns: { provider: byProvider, model: byModel, plan: byPlan, persona: byPersona, workload: byWorkload },
      topUsers: users,
      modelEconomics: models,
      time: now.toISOString(),
    });
  } catch (err) {
    return handleError(err, 'admin.ai.usage');
  }
}
