import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/server/auth/guards';
import { getDb } from '@/server/db';
import { organizationRoleDefinitions } from '@/server/db/schema';
import { handleError, ok, badRequest } from '@/lib/api';
import { roleDefinitionSchema } from '@/lib/validation';
import { requireOrgPermission } from '@/server/enterprise/guard';
import { BUILTIN_ROLES, sanitizePermissions, ALL_PERMISSIONS } from '@/server/enterprise/rbac';
import { logSecurityEvent } from '@/server/auth/events';

/** GET built-in + custom roles; POST a custom role (validated permissions only). */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'role';
}

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'members.read');
    const custom = await getDb().select().from(organizationRoleDefinitions).where(eq(organizationRoleDefinitions.organizationId, access.organizationId));
    return ok({
      builtin: Object.entries(BUILTIN_ROLES).map(([slug, r]) => ({ slug, name: r.name, permissions: r.permissions, systemRole: true })),
      custom: custom.map((r) => ({ id: r.id, slug: r.slug, name: r.name, permissions: r.permissions, enabled: r.enabled, systemRole: r.systemRole })),
      vocabulary: ALL_PERMISSIONS,
    });
  } catch (err) {
    return handleError(err, 'org.roles.get');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ('response' in auth) return auth.response;
  try {
    const access = await requireOrgPermission(req, auth.user.id, 'security.manage');
    const input = roleDefinitionSchema.parse(await req.json());
    const perms = sanitizePermissions(input.permissions);
    if (perms.length !== input.permissions.length) return badRequest('One or more permissions are not recognized.');
    const [row] = await getDb()
      .insert(organizationRoleDefinitions)
      .values({ organizationId: access.organizationId, slug: slugify(input.name), name: input.name, description: input.description ?? null, permissions: perms, systemRole: false })
      .returning();
    await logSecurityEvent({ event: 'enterprise.role_changed', actorUserId: auth.user.id, organizationId: access.organizationId, metadata: { role: row.slug, permissions: perms } });
    return ok({ role: { id: row.id, slug: row.slug, name: row.name, permissions: row.permissions } });
  } catch (err) {
    return handleError(err, 'org.roles.create');
  }
}
