import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { getPlan } from '@/server/ai/plans';
import { handleError, ok } from '@/lib/api';
import { setExperienceSchema } from '@/lib/validation';
import { getUserExperienceId, onboardingChoices, resolveActiveExperience, setUserExperience } from '@/server/experience/service';
import { getExperienceProfile } from '@/config/experience-profiles';

/**
 * GET  /api/experience — the caller's active experience profile + onboarding choices.
 * POST /api/experience — set the caller's default experience (validated server-side).
 * Selecting a persona changes defaults/presentation; it never grants capability.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function publicProfile(p: ReturnType<typeof getExperienceProfile>) {
  return {
    id: p.id,
    slug: p.slug,
    label: p.label,
    audienceType: p.audienceType,
    defaultModelProfile: p.defaultModelProfile,
    navigation: p.navigation,
    home: p.home,
    recommendedCapabilities: p.recommendedCapabilities,
    allowedCapabilities: p.allowedCapabilities,
    recommendedCategories: p.recommendedCategories,
    accent: p.accent,
  };
}

export async function GET() {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const plan = await getPlan(auth.user.plan);
    const activeId = await getUserExperienceId(auth.user.id);
    const active = resolveActiveExperience(activeId, plan);
    return ok({ active: publicProfile(active), choices: onboardingChoices(plan).map(publicProfile) });
  } catch (err) {
    return handleError(err, 'experience.get');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const { personaId } = setExperienceSchema.parse(await req.json());
    const plan = await getPlan(auth.user.plan);
    const profile = await setUserExperience(auth.user.id, personaId, plan);
    return ok({ active: publicProfile(profile) });
  } catch (err) {
    return handleError(err, 'experience.set');
  }
}
