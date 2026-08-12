import { NextRequest } from 'next/server';
import { requireUser } from '@/server/auth/guards';
import { isOrgManager } from '@/server/auth/permissions';
import { activeWorkspace } from '@/server/org/workspace';
import { getPlan } from '@/server/ai/plans';
import { createMemorySchema } from '@/lib/validation';
import { handleError, ok, forbidden } from '@/lib/api';
import { createMemory, listMemories } from '@/server/memory/store';
import { supersedeConflicting } from '@/server/memory/extraction';
import { memoryPlatformEnabled, organizationMemoryPlatformEnabled } from '@/server/memory/config';

/**
 * GET  /api/memory — list the caller's ACTIVE memories in the active scope.
 * POST /api/memory — create an EXPLICIT memory (personal, or org if a manager).
 * Ownership is derived server-side; the browser can never target another owner.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const ws = await activeWorkspace(req, auth.user.id);
    const url = new URL(req.url);
    const search = url.searchParams.get('search') ?? undefined;
    const rows = await listMemories({ userId: auth.user.id, organizationId: ws.organizationId }, { search });
    return ok({
      memories: rows.map((m) => ({ id: m.id, content: m.content, type: m.memoryType, scope: m.scope, source: m.sourceType, sensitivity: m.sensitivity, confidence: m.confidence, ownerType: m.ownerType, createdAt: m.createdAt, updatedAt: m.updatedAt })),
    });
  } catch (err) {
    return handleError(err, 'memory.list');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    if (!memoryPlatformEnabled()) return forbidden('Memory is currently disabled.');
    const plan = await getPlan(auth.user.plan);
    if (!plan.memoryEnabled) return forbidden('Your plan does not include memory.');
    const input = createMemorySchema.parse(await req.json());
    const ws = await activeWorkspace(req, auth.user.id);

    if (input.ownerType === 'ORGANIZATION') {
      if (!organizationMemoryPlatformEnabled()) return forbidden('Organization memory is currently disabled.');
      if (!plan.organizationMemoryEnabled) return forbidden('Your plan does not include organization memory.');
      if (!ws.organizationId || !ws.role || !isOrgManager(ws.role as 'OWNER' | 'ADMIN' | 'MEMBER')) return forbidden('Only organization managers can create organization memory.');
    }

    const mem = await createMemory({
      ownerType: input.ownerType,
      ownerUserId: auth.user.id,
      organizationId: input.ownerType === 'ORGANIZATION' ? ws.organizationId : null,
      createdByUserId: auth.user.id,
      memoryType: input.memoryType,
      content: input.content,
      sourceType: input.ownerType === 'ORGANIZATION' ? 'ORGANIZATION_DEFINED' : 'USER_EXPLICIT',
      scope: input.scope,
      scopeRef: input.scopeRef ?? null,
      importance: input.importance,
      confidence: 1,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      consented: input.confirmSensitive,
      plan,
    });
    await supersedeConflicting(mem, auth.user.id); // an explicit newer statement supersedes conflicts
    return ok({ ok: true, memory: { id: mem.id, content: mem.content, type: mem.memoryType, sensitivity: mem.sensitivity } });
  } catch (err) {
    return handleError(err, 'memory.create');
  }
}
