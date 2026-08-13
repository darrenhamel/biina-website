/**
 * Server-enforced signup gating for the invite-only beta.
 *
 * The beta is deliberately small (5–20 users). Public self-service signup is CLOSED by
 * default in that posture: an account is created only for an email the operator has put
 * on the allowlist. This is enforced on the SERVER (the signup route), never in the UI —
 * hiding the form is not a control.
 *
 * Config (all via env, no code change to flip):
 *   SIGNUP_MODE=invite_only | open        (default: 'open')
 *   SIGNUP_ALLOWLIST=a@x.com, b@y.com, @trusteddomain.com
 *     - exact email match (case-insensitive), OR
 *     - a leading-'@' domain entry matches any address at that domain.
 *
 * `open` preserves today's behavior (used in dev and if the operator opens registration).
 * `invite_only` with an empty allowlist rejects everyone — fail CLOSED, never open.
 */

export type SignupMode = 'open' | 'invite_only';

export function signupMode(env: NodeJS.ProcessEnv = process.env): SignupMode {
  return (env.SIGNUP_MODE || 'open').toLowerCase() === 'invite_only' ? 'invite_only' : 'open';
}

/** Parse the comma/whitespace-separated allowlist into normalized lower-case entries. */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Is this email permitted to create an account right now? In `open` mode everyone is.
 * In `invite_only` mode the email must match the allowlist (exact address, or a
 * '@domain' entry). Fails CLOSED on an empty allowlist.
 */
export function isSignupAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (signupMode(env) === 'open') return true;
  const addr = email.trim().toLowerCase();
  if (!addr.includes('@')) return false;
  const domain = `@${addr.split('@')[1]}`;
  const allow = parseAllowlist(env.SIGNUP_ALLOWLIST);
  return allow.includes(addr) || allow.includes(domain);
}
