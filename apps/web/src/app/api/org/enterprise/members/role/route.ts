import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireUser } from '@/server/auth/guards';
import { getDb } from '@/server/db';
import { organizationMembers, organizationRoleDefinitions } from '@/server/db/schema';
import { handleError, ok, badRequest } from '@/lib/api';
import { assignRoleSchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { logSecurityEvent } from '@/server/auth/events';
import { AppError } from '@/lib/errors';

/**
 * PUT — assign a custom role definition to a member. Requires members.manage. A member
 * can NEVER escalate themselves: assigning a role to yourself is rejected, so a
 * non-privileged member cannot grant themselves Security/AI/Owner permissions.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'members.manage');
    const { userId, roleDefinitionId } = assignRoleSchema.parse(await req.json());
    // Separation of duties: you cannot change your OWN role assignment.
    if (userId === auth.user.id) throw new AppError(403, 'You cannot change your own role.', 'self_role');
    const db = getDb();
    if (roleDefinitionId) {
      const [def] = await db.select().from(organizationRoleDefinitions).where(and(eq(organizationRoleDefinitions.id, roleDefinitionId), eq(organizationRoleDefinitions.organizationId, access.organizationId))).limit(1);
      if (!def) return badRequest('Unknown role for this organization.');
    }
    const [member] = await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, access.organizationId), eq(organizationMembers.userId, userId))).limit(1);
    if (!member) return badRequest('User is not a member of this organization.');
    await db.update(organizationMembers).set({ roleDefinitionId, updatedAt: new Date() }).where(eq(organizationMembers.id, member.id));
    await logSecurityEvent({ event: 'enterprise.role_assigned', actorUserId: auth.user.id, organizationId: access.organizationId, userId, metadata: { roleDefinitionId } });
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'org.members.role');
  }
}
