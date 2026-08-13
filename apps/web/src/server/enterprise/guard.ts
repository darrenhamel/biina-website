import type { NextRequest } from 'next/server';
import { activeWorkspace } from '@/server/org/workspace';
import { resolveOrgContextById } from '@/server/org/organizations';
import { AppError } from '@/lib/errors';
import { resolveMemberPermissions, hasPermission, type Permission } from './rbac';
import { enterpriseFeaturesEnabled } from './config';

/**
 * Enterprise access guard. Resolves the caller's ACTIVE organization context and their
 * effective enterprise permissions, then asserts the required permission. Authorization
 * is server-side only — never inferred from the browser. Enterprise features must be
 * enabled AND the caller must actually hold the permission in THIS organization.
 */

export interface EnterpriseAccess {
  organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  permissions: Permission[];
}

export async function requireOrgPermission(req: NextRequest, userId: string, required: Permission): Promise<EnterpriseAccess> {
  if (!enterpriseFeaturesEnabled()) throw new AppError(403, 'Enterprise features are not enabled.', 'enterprise_disabled');
  const ws = await activeWorkspace(req, userId);
  if (!ws.organizationId) throw new AppError(400, 'Select an organization workspace.', 'no_org');
  if (ws.suspended) throw new AppError(403, 'This workspace is unavailable.', 'org_suspended');
  const ctx = await resolveOrgContextById(userId, ws.organizationId);
  if (!ctx) throw new AppError(403, 'Organization membership required.', 'not_member');
  const member = ctx.membership as { roleDefinitionId?: string | null; active?: boolean };
  if (member.active === false) throw new AppError(403, 'Your organization access is inactive.', 'member_inactive');
  const permissions = await resolveMemberPermissions({ organizationId: ws.organizationId, role: ctx.role, roleDefinitionId: member.roleDefinitionId ?? null });
  if (!hasPermission(permissions, required)) throw new AppError(403, 'You do not have permission for this action.', 'forbidden');
  return { organizationId: ws.organizationId, role: ctx.role, permissions };
}
