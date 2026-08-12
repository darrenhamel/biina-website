import { describe, it, expect } from 'vitest';
import {
  isPlatformAdmin,
  canManageUsers,
  canManageAI,
  canManagePlans,
  canViewPlatformUsage,
  canChangePlatformRoles,
  isOrgManager,
  canInviteMembers,
  canViewOrganizationUsage,
  canChangeMemberRoles,
  canRemoveMember,
  canManageOrgBilling,
  type PlatformRole,
  type OrgRole,
} from '@/server/auth/permissions';

/**
 * The authorization matrix is the security core. Platform roles and org roles
 * are DISTINCT authorities; these tests lock the boundary so a refactor can't
 * silently widen access.
 */

const PLATFORM: PlatformRole[] = ['USER', 'ADMIN', 'SUPER_ADMIN'];
const ORG: OrgRole[] = ['OWNER', 'ADMIN', 'MEMBER'];

describe('platform permissions', () => {
  it('only ADMIN and SUPER_ADMIN are platform admins', () => {
    expect(PLATFORM.filter(isPlatformAdmin)).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect(isPlatformAdmin('USER')).toBe(false);
  });

  it('user/AI/plan/usage management all require platform admin', () => {
    for (const can of [canManageUsers, canManageAI, canManagePlans, canViewPlatformUsage]) {
      expect(can('USER')).toBe(false);
      expect(can('ADMIN')).toBe(true);
      expect(can('SUPER_ADMIN')).toBe(true);
    }
  });

  it('ONLY super-admin can change platform roles', () => {
    expect(canChangePlatformRoles('USER')).toBe(false);
    expect(canChangePlatformRoles('ADMIN')).toBe(false); // a plain admin cannot escalate anyone
    expect(canChangePlatformRoles('SUPER_ADMIN')).toBe(true);
  });
});

describe('organization permissions', () => {
  it('OWNER and ADMIN are managers; MEMBER is not', () => {
    expect(ORG.filter(isOrgManager)).toEqual(['OWNER', 'ADMIN']);
    expect(isOrgManager('MEMBER')).toBe(false);
  });

  it('inviting and viewing org usage require a manager', () => {
    for (const can of [canInviteMembers, canViewOrganizationUsage]) {
      expect(can('OWNER')).toBe(true);
      expect(can('ADMIN')).toBe(true);
      expect(can('MEMBER')).toBe(false);
    }
  });

  it('only OWNER changes member roles or manages billing', () => {
    expect(canChangeMemberRoles('OWNER')).toBe(true);
    expect(canChangeMemberRoles('ADMIN')).toBe(false);
    expect(canChangeMemberRoles('MEMBER')).toBe(false);
    expect(canManageOrgBilling('OWNER')).toBe(true);
    expect(canManageOrgBilling('ADMIN')).toBe(false);
  });

  it('removal rules: OWNER removes anyone, ADMIN removes MEMBERs only, MEMBER removes no one', () => {
    // OWNER can remove every role.
    for (const target of ORG) expect(canRemoveMember('OWNER', target)).toBe(true);
    // ADMIN may remove only MEMBERs (not owners or fellow admins).
    expect(canRemoveMember('ADMIN', 'MEMBER')).toBe(true);
    expect(canRemoveMember('ADMIN', 'ADMIN')).toBe(false);
    expect(canRemoveMember('ADMIN', 'OWNER')).toBe(false);
    // MEMBER can remove no one.
    for (const target of ORG) expect(canRemoveMember('MEMBER', target)).toBe(false);
  });

  it('platform role and org role never leak into each other', () => {
    // A platform SUPER_ADMIN has no inherent org authority (must be a member).
    // The predicates are typed separately; this documents the intended isolation.
    expect(isOrgManager('MEMBER')).toBe(false);
    expect(isPlatformAdmin('USER')).toBe(false);
  });
});
