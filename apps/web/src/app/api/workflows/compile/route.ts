import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { getPlan } from '@/server/ai/plans';
import { compileWorkflowSchema } from '@/lib/validation';
import { handleError, ok, forbidden } from '@/lib/api';
import { draftFromNaturalLanguage, validateWorkflowConfig } from '@/server/workflows/compiler';

/**
 * POST /api/workflows/compile — turn a natural-language request into a DRAFT
 * workflow config (deterministic; never executes model JSON). The client reviews
 * and edits the draft before creating + activating it.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const plan = await getPlan(auth.user.plan);
    if (!plan.workflowsEnabled) return forbidden('Your plan does not include workflows.');
    const { text, timezone } = compileWorkflowSchema.parse(await req.json());
    const draft = draftFromNaturalLanguage(text, timezone || 'UTC');
    const issues = validateWorkflowConfig(draft);
    return ok({ draft, issues });
  } catch (err) {
    return handleError(err, 'workflows.compile');
  }
}
