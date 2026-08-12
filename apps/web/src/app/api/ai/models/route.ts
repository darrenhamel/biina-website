import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { isPlatformAdmin } from '@/server/auth/permissions';
import { loadAiConfig } from '@/server/ai/catalog';
import { unauthorized, handleError } from '@/lib/api';

/**
 * GET /api/ai/models — the models a user may pick in the chat UI.
 *
 * Returns ONLY enabled + user-visible BIINA models (admins also see admin-only
 * ones). Consumer-safe fields only — never the provider or infra model name.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    const isAdmin = isPlatformAdmin(user.role);

    const snap = await loadAiConfig();
    const models = snap.models
      .filter((m) => m.enabled && !m.maintenanceMode && m.visibleToUsers && (!m.adminOnly || isAdmin))
      .sort((a, b) => a.priority - b.priority)
      .map((m) => ({
        slug: m.slug,
        displayName: m.displayName, // "BIINA", "BIINA Fast" — never infra
        description: m.description ?? undefined,
        capabilities: m.capabilities,
      }));

    return NextResponse.json({ models });
  } catch (err) {
    return handleError(err, 'ai.models');
  }
}
