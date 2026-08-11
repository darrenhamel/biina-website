/**
 * Minimal structured logger.
 *
 * Emits single-line JSON to stdout. NEVER pass secrets (API keys, passwords,
 * tokens) — there is a small redaction guard, but the real rule is: don't log
 * them. Request-scoped logs carry a `requestId` for correlation.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACT_KEYS = /pass(word)?|secret|token|api[-_]?key|authorization|cookie/i;

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = REDACT_KEYS.test(k) ? '[redacted]' : v;
  }
  return out;
}

function emit(level: Level, msg: string, meta: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...redact(meta) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};
