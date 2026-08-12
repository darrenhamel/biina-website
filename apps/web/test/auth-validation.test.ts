import { describe, it, expect } from 'vitest';
import {
  changePasswordSchema,
  resetPasswordSchema,
  forgotPasswordSchema,
  tokenSchema,
  createOrgSchema,
  inviteSchema,
  memberRoleSchema,
  setUserStatusSchema,
  setUserRoleSchema,
  setOrgStatusSchema,
} from '@/lib/validation';
import { AppError, badRequest, forbidden, notFound, conflict, isAppError } from '@/lib/errors';

describe('Phase 6 identity validation', () => {
  it('change-password requires an 8+ char new password', () => {
    expect(() => changePasswordSchema.parse({ currentPassword: 'x', newPassword: 'short' })).toThrow();
    expect(changePasswordSchema.parse({ currentPassword: 'x', newPassword: 'longenough' }).newPassword).toBe('longenough');
  });

  it('reset-password rejects a too-short token', () => {
    expect(() => resetPasswordSchema.parse({ token: 'abc', newPassword: 'longenough' })).toThrow();
  });

  it('forgot-password lowercases the email', () => {
    expect(forgotPasswordSchema.parse({ email: 'A@B.CO' }).email).toBe('a@b.co');
  });

  it('token schema requires a plausible token length', () => {
    expect(() => tokenSchema.parse({ token: 'short' })).toThrow();
    expect(tokenSchema.parse({ token: 'a'.repeat(32) }).token.length).toBe(32);
  });
});

describe('Phase 6 organization validation', () => {
  it('create-org requires a 2+ char name', () => {
    expect(() => createOrgSchema.parse({ name: 'a' })).toThrow();
    expect(createOrgSchema.parse({ name: 'Acme' }).name).toBe('Acme');
  });

  it('invite defaults role to MEMBER and validates the enum', () => {
    expect(inviteSchema.parse({ email: 'x@y.co' }).role).toBe('MEMBER');
    expect(() => inviteSchema.parse({ email: 'x@y.co', role: 'SUPERUSER' })).toThrow();
  });

  it('member-role only accepts org roles', () => {
    expect(memberRoleSchema.parse({ role: 'ADMIN' }).role).toBe('ADMIN');
    expect(() => memberRoleSchema.parse({ role: 'SUPER_ADMIN' })).toThrow();
  });
});

describe('Phase 6 admin validation', () => {
  it('user status only accepts the account-status enum', () => {
    expect(setUserStatusSchema.parse({ status: 'SUSPENDED', reason: 'abuse' }).status).toBe('SUSPENDED');
    expect(() => setUserStatusSchema.parse({ status: 'DELETED' })).toThrow();
  });

  it('user role only accepts platform roles', () => {
    expect(setUserRoleSchema.parse({ role: 'SUPER_ADMIN' }).role).toBe('SUPER_ADMIN');
    expect(() => setUserRoleSchema.parse({ role: 'OWNER' })).toThrow();
  });

  it('org status is ACTIVE or SUSPENDED only', () => {
    expect(setOrgStatusSchema.parse({ status: 'ACTIVE' }).status).toBe('ACTIVE');
    expect(() => setOrgStatusSchema.parse({ status: 'DISABLED' })).toThrow();
  });
});

describe('AppError HTTP mapping', () => {
  it('helpers carry the right status + code', () => {
    expect(badRequest('x')).toMatchObject({ status: 400, code: 'bad_request' });
    expect(forbidden()).toMatchObject({ status: 403, code: 'forbidden' });
    expect(notFound()).toMatchObject({ status: 404, code: 'not_found' });
    expect(conflict('x')).toMatchObject({ status: 409, code: 'conflict' });
  });

  it('is identifiable via isAppError and carries a message', () => {
    const err = conflict('only owner');
    expect(isAppError(err)).toBe(true);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe('only owner');
    expect(isAppError(new Error('nope'))).toBe(false);
  });
});
