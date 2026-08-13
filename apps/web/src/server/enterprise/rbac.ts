import { eq, and } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { organizationRoleDefinitions } from '@/server/db/schema';
import type { OrgRole } from '@/server/auth/permissions';

/**
 * Enterprise RBAC (Phase 17). Extends the coarse OWNER/ADMIN/MEMBER model with a
 * validated permission vocabulary + reusable role definitions, WITHOUT role sprawl.
 * Permissions are `<domain>.<action>` strings validated against this vocabulary — no
 * arbitrary permission strings. Least privilege is the default: a member with no
 * custom role gets only what their base org role grants. An OWNER always retains full
 * control (can never be locked out of their own org).
 */

export const PERMISSION_DOMAINS = ['members', 'groups', 'identity', 'billing', 'ai_models', 'knowledge', 'connectors', 'agents', 'workflows', 'research', 'library', 'audit', 'security', 'retention'] as const;
export type PermissionDomain = (typeof PERMISSION_DOMAINS)[number];
export const ACTIONS = ['read', 'manage'] as const;
export type PermissionAction = (typeof ACTIONS)[number];

export type Permission = `${PermissionDomain}.${PermissionAction}` | '*';

export const ALL_PERMISSIONS: Permission[] = PERMISSION_DOMAINS.flatMap((d) => ACTIONS.map((a) => `${d}.${a}` as Permission));

export function isValidPermission(p: string): p is Permission {
  return p === '*' || (ALL_PERMISSIONS as string[]).includes(p);
}

/** Keep only recognized permissions (defensive against arbitrary strings). */
export function sanitizePermissions(perms: string[]): Permission[] {
  return perms.filter(isValidPermission) as Permission[];
}

/** Built-in, immutable role catalog. Least privilege by design + separation of duties. */
export const BUILTIN_ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  'org-owner': { name: 'Organization Owner', permissions: ['*'] },
  'org-admin': {
    name: 'Organization Admin',
    permissions: ['members.manage', 'groups.manage', 'connectors.manage', 'agents.manage', 'workflows.manage', 'research.manage', 'library.manage', 'knowledge.manage', 'ai_models.read', 'audit.read'],
  },
  'security-admin': { name: 'Security Admin', permissions: ['security.manage', 'identity.manage', 'audit.read', 'retention.read', 'members.read'] },
  'ai-admin': { name: 'AI Admin', permissions: ['ai_models.manage', 'agents.manage', 'workflows.manage', 'research.manage'] },
  'knowledge-admin': { name: 'Knowledge Admin', permissions: ['knowledge.manage', 'library.manage'] },
  'billing-admin': { name: 'Billing Admin', permissions: ['billing.manage'] },
  auditor: { name: 'Auditor', permissions: ['audit.read'] },
  member: { name: 'Member', permissions: [] },
};

/** Permissions implied purely by the base org role (before any custom role). */
export function baseRolePermissions(role: OrgRole): Permission[] {
  if (role === 'OWNER') return ['*'];
  if (role === 'ADMIN') return BUILTIN_ROLES['org-admin'].permissions;
  return [];
}

export function hasPermission(perms: Permission[], required: Permission): boolean {
  if (perms.includes('*')) return true;
  if (perms.includes(required)) return true;
  // `<domain>.manage` implies `<domain>.read`.
  if (required.endsWith('.read')) {
    const manage = required.replace(/\.read$/, '.manage') as Permission;
    if (perms.includes(manage)) return true;
  }
  return false;
}

/**
 * Resolve a member's effective permissions. An OWNER is always full. Otherwise, a
 * custom role definition (if assigned) provides the permission set; without one, the
 * base org role applies. Custom roles never exceed the validated vocabulary.
 */
export async function resolveMemberPermissions(input: { organizationId: string; role: OrgRole; roleDefinitionId?: string | null }): Promise<Permission[]> {
  if (input.role === 'OWNER') return ['*'];
  if (input.roleDefinitionId) {
    const [def] = await getDb()
      .select()
      .from(organizationRoleDefinitions)
      .where(and(eq(organizationRoleDefinitions.id, input.roleDefinitionId), eq(organizationRoleDefinitions.organizationId, input.organizationId)))
      .limit(1);
    if (def && def.enabled) return sanitizePermissions(def.permissions as string[]);
  }
  return baseRolePermissions(input.role);
}
