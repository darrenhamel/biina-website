import { describe, it, expect } from 'vitest';
import { signupSchema, loginSchema, chatRequestSchema } from '@/lib/validation';

describe('validation schemas', () => {
  it('accepts a valid signup and normalizes email', () => {
    const parsed = signupSchema.parse({
      displayName: 'Sara',
      email: 'Sara@Example.COM',
      password: 'supersecret',
    });
    expect(parsed.email).toBe('sara@example.com');
  });

  it('rejects short passwords', () => {
    expect(() =>
      signupSchema.parse({ displayName: 'x', email: 'a@b.com', password: 'short' }),
    ).toThrow();
  });

  it('rejects invalid email on login', () => {
    expect(() => loginSchema.parse({ email: 'not-an-email', password: 'x' })).toThrow();
  });

  it('requires a non-empty chat message', () => {
    expect(() => chatRequestSchema.parse({ message: '   ' })).toThrow();
    expect(chatRequestSchema.parse({ message: 'hi' }).message).toBe('hi');
  });

  it('accepts an optional conversationId only if uuid', () => {
    expect(() => chatRequestSchema.parse({ message: 'hi', conversationId: 'nope' })).toThrow();
  });
});
