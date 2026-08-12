/**
 * Minimal in-memory sliding-window rate limiter (per-instance).
 *
 * Used to slow auth abuse (login/signup/reset/verify/invite). Per-instance and
 * best-effort — a shared limiter (e.g. Redis) can replace it later without
 * changing call sites. Keys should include the action and a client identifier
 * (IP and/or email) so one attacker can't exhaust everyone.
 */

interface Window {
  hits: number[];
}
const store = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec?: number;
}

export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const w = store.get(key) ?? { hits: [] };
  // Drop expired hits.
  w.hits = w.hits.filter((t) => t > cutoff);

  if (w.hits.length >= max) {
    const retryAfterSec = Math.ceil((w.hits[0]! + windowMs - now) / 1000);
    store.set(key, w);
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  w.hits.push(now);
  store.set(key, w);

  // Opportunistic cleanup to bound memory.
  if (store.size > 10_000) {
    for (const [k, v] of store) {
      if (v.hits.every((t) => t <= cutoff)) store.delete(k);
    }
  }
  return { allowed: true, remaining: max - w.hits.length };
}

/** Convenience presets for auth flows. */
export const RL = {
  login: { max: 10, windowMs: 60_000 },
  signup: { max: 5, windowMs: 60_000 },
  forgot: { max: 5, windowMs: 60_000 },
  reset: { max: 10, windowMs: 60_000 },
  verifyResend: { max: 3, windowMs: 60_000 },
  invite: { max: 20, windowMs: 60_000 },
} as const;
