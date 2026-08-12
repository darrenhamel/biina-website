/**
 * Central authorization — the ONE place role checks live.
 *
 * PLATFORM roles (users.role: USER / ADMIN / SUPER_ADMIN) and ORGANIZATION roles
 * (OWNER / ADMIN / MEMBER) are DISTINCT authorities. Never conflate them. All of
 * these are pure predicates; server routes call them, never `role === 'ADMIN'`
 * inline.
 */

export type PlatformRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';
export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';

// ---- Platform ----

export function isPlatformAdmin(role: PlatformRole): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export const canManageUsers = isPlatformAdmin;
export const canManageAI = isPlatformAdmin;
export const canManagePlans = isPlatformAdmin;
export const canManageOrganizationsPlatform = isPlatformAdmin;
export const canViewPlatformUsage = isPlatformAdmin;

/** Only SUPER_ADMIN may grant/revoke platform ADMIN or suspend other admins. */
export function canChangePlatformRoles(role: PlatformRole): boolean {
  return role === 'SUPER_ADMIN';
}

// ---- Organization ----

export function isOrgManager(role: OrgRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export const canManageOrganization = isOrgManager; // general settings
export const canInviteMembers = isOrgManager;
export const canViewOrganizationUsage = isOrgManager;

/** Only OWNER changes member roles (promote/demote admins) or transfers ownership. */
export function canChangeMemberRoles(role: OrgRole): boolean {
  return role === 'OWNER';
}

/**
 * Who an actor may remove: OWNER may remove anyone (owner-count protected
 * elsewhere); ADMIN may remove MEMBERs only; MEMBER may remove no one.
 */
export function canRemoveMember(actor: OrgRole, target: OrgRole): boolean {
  if (actor === 'OWNER') return true;
  if (actor === 'ADMIN') return target === 'MEMBER';
  return false;
}

export function canManageOrgBilling(role: OrgRole): boolean {
  return role === 'OWNER';
}
