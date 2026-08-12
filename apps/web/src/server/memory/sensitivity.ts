/**
 * Deterministic sensitivity classification + secret detection for memory.
 *
 * This is a POLICY layer, not an ML DLP engine: it uses conservative pattern
 * matching so that (a) credentials/tokens NEVER become durable memory, and (b)
 * sensitive/restricted categories are flagged for stricter handling (never
 * auto-inferred). It runs on every memory write regardless of source.
 */

export type Sensitivity = 'NORMAL' | 'SENSITIVE' | 'RESTRICTED';

/** Patterns for credentials/secrets that must never be stored as memory. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{16,}\b/, // OpenAI-style keys
  /\bya29\.[A-Za-z0-9._-]{10,}\b/, // Google OAuth access tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{20,}\b/, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /\b(?:api[_-]?key|secret|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b\s*[:=]\s*\S{8,}/i,
  /\b(?:password|passwd|pwd)\b\s*(?:is|:|=)\s*\S{4,}/i,
];

/** Keyword groups that mark content as SENSITIVE or RESTRICTED (never auto-inferred). */
const RESTRICTED_HINTS = [
  /\b(?:credit\s?card|iban|cvv|card\s?number|bank\s?account|routing\s?number)\b/i,
  /\b(?:ssn|social\s?security|passport\s?(?:no|number)|national\s?id|emirates\s?id)\b/i,
  /\b(?:diagnos(?:is|ed)|medical\s?condition|prescription|blood\s?type|hiv|pregnan)/i,
];
const SENSITIVE_HINTS = [
  /\b(?:salary|income|net\s?worth|religion|political|sexual\s?orientation|ethnicity)\b/i,
  /\b(?:home\s?address|lives?\s?at|gps|coordinates|geolocation)\b/i,
];

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

/** Replace any secret-looking spans with a placeholder (best-effort). */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), '[redacted]');
  return out;
}

export function classifySensitivity(text: string): Sensitivity {
  if (RESTRICTED_HINTS.some((re) => re.test(text))) return 'RESTRICTED';
  if (SENSITIVE_HINTS.some((re) => re.test(text))) return 'SENSITIVE';
  return 'NORMAL';
}

/** Content that must NEVER become an INFERRED memory (only explicit + consented). */
export function isAutoInferable(text: string): boolean {
  if (containsSecret(text)) return false;
  return classifySensitivity(text) === 'NORMAL';
}

/**
 * Phrases that indicate an attempt to smuggle instructions/policy into memory —
 * blocked from ALL memory paths (poisoning/system-prompt-as-memory defense).
 */
const INSTRUCTION_INJECTION = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|the)\s+(?:instructions|rules)/i,
  /\b(?:disable|ignore|bypass|turn\s+off)\b[^.]*\bsafety\b/i,
  /\bsafety\b[^.]*\b(?:disabled|turned\s+off|ignored|bypassed|off)\b/i,
  /\bsystem\s*(?:prompt|:)/i,
  /\byou\s+are\s+now\b/i,
  /\bsend\b[^.]*\bto\b[^.]*@/i, // "send <anything> to <email>"
  /\b(?:always|permanently)\s+(?:send|email|forward)\b[^.]*@/i,
  /\bremember\s+permanently\b/i,
];
export function looksLikeInjection(text: string): boolean {
  return INSTRUCTION_INJECTION.some((re) => re.test(text));
}

/** A memory candidate is storable only if it is not a secret and not an injection. */
export function isStorableContent(text: string): { ok: boolean; reason?: string } {
  if (containsSecret(text)) return { ok: false, reason: 'contains a secret/credential' };
  if (looksLikeInjection(text)) return { ok: false, reason: 'looks like an injected instruction' };
  if (text.trim().length < 3) return { ok: false, reason: 'too short' };
  return { ok: true };
}
