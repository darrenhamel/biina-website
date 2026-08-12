import { describe, it, expect } from 'vitest';
import { rateLimit, RL } from '@/server/lib/rate-limit';

/** Sliding-window limiter that protects the auth flows from brute force. */
describe('rate limiter', () => {
  it('allows up to max within the window then blocks', () => {
    const key = `test:${Math.random()}`;
    const max = 3;
    for (let i = 0; i < max; i++) {
      expect(rateLimit(key, max, 60_000).allowed).toBe(true);
    }
    const blocked = rateLimit(key, max, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('keys are isolated — one client cannot exhaust another', () => {
    const a = `a:${Math.random()}`;
    const b = `b:${Math.random()}`;
    expect(rateLimit(a, 1, 60_000).allowed).toBe(true);
    expect(rateLimit(a, 1, 60_000).allowed).toBe(false);
    // Different key is unaffected.
    expect(rateLimit(b, 1, 60_000).allowed).toBe(true);
  });

  it('a tiny window expires immediately so old hits do not count', async () => {
    const key = `win:${Math.random()}`;
    expect(rateLimit(key, 1, 1).allowed).toBe(true); // 1ms window
    await new Promise((r) => setTimeout(r, 5));
    expect(rateLimit(key, 1, 1).allowed).toBe(true); // prior hit aged out
  });

  it('presets are configured for the auth surfaces', () => {
    expect(RL.login.max).toBeGreaterThan(0);
    expect(RL.verifyResend.max).toBeLessThanOrEqual(RL.login.max); // resend is the tightest
    for (const p of Object.values(RL)) expect(p.windowMs).toBe(60_000);
  });
});
