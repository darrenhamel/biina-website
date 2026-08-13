/**
 * Production configuration validation + mode guards (Phase 18).
 *
 * A production deployment must FAIL SAFE if critical configuration is missing or looks
 * like a development placeholder. This module reports problems WITHOUT ever logging the
 * secret VALUES — only variable names + presence/shape. It also centralizes the
 * "are we really in production" and "may mock/dev features run" guards so those checks
 * are consistent everywhere.
 */

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.BIINA_ENV === 'production';
}

/** Dev-only conveniences (mock providers, seed admin, dev tokens) must never run in prod. */
export function devFeaturesAllowed(): boolean {
  if (!isProduction()) return true;
  // An explicit, deliberate override for a non-standard environment (documented, discouraged).
  return process.env.ALLOW_DEV_FEATURES_IN_PROD === 'true';
}

export interface ConfigFinding {
  key: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  message: string; // never contains the secret value
}

interface Rule {
  key: string;
  severity: ConfigFinding['severity'];
  /** Required in production. */
  requiredInProd?: boolean;
  /** Minimum length for a credential/secret (shape check only). */
  minLength?: number;
  /** Value must NOT be one of these dev placeholders. */
  forbidden?: string[];
  /** Custom shape check returning an error message, or null if OK. */
  check?: (v: string) => string | null;
  note?: string;
}

const RULES: Rule[] = [
  { key: 'DATABASE_URL', severity: 'CRITICAL', requiredInProd: true },
  { key: 'AUTH_SECRET', severity: 'CRITICAL', requiredInProd: true, minLength: 32, forbidden: ['dev', 'development', 'changeme', 'secret'] },
  { key: 'CONNECTOR_CREDENTIAL_ENCRYPTION_KEY', severity: 'CRITICAL', requiredInProd: true, minLength: 32, forbidden: ['dev', 'changeme'] },
  { key: 'NEXT_PUBLIC_APP_URL', severity: 'HIGH', requiredInProd: true, check: (v) => (v.startsWith('https://') ? null : 'production base URL must be https://') },
  { key: 'STRIPE_SECRET_KEY', severity: 'HIGH', check: (v) => (v.startsWith('sk_live_') || v.startsWith('sk_test_') ? null : 'not a valid Stripe secret key shape') },
  { key: 'STRIPE_WEBHOOK_SECRET', severity: 'HIGH', check: (v) => (v.startsWith('whsec_') ? null : 'not a valid Stripe webhook secret shape') },
  { key: 'AI_DEFAULT_PROVIDER', severity: 'HIGH', note: 'must not be "mock" in production' },
  { key: 'RESEND_API_KEY', severity: 'MEDIUM', note: 'production email delivery' },
  { key: 'FILE_STORAGE_PROVIDER', severity: 'MEDIUM', note: 'local storage is not durable for production' },
];

/** Validate configuration. Safe to call anywhere — returns findings; logs nothing. */
export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env): { ok: boolean; findings: ConfigFinding[]; production: boolean } {
  const production = env.NODE_ENV === 'production' || env.BIINA_ENV === 'production';
  const findings: ConfigFinding[] = [];
  const push = (key: string, severity: ConfigFinding['severity'], message: string) => findings.push({ key, severity, message });

  for (const r of RULES) {
    const raw = env[r.key];
    const present = raw != null && raw !== '';
    if (!present) {
      if (r.requiredInProd && production) push(r.key, r.severity, `missing (required in production)`);
      else if (r.note) push(r.key, 'INFO', `not set — ${r.note}`);
      continue;
    }
    const v = raw!;
    if (r.minLength && v.length < r.minLength) push(r.key, r.severity, `too short (< ${r.minLength} chars) — weak secret`);
    if (r.forbidden && r.forbidden.some((f) => v.toLowerCase().includes(f))) push(r.key, r.severity, `looks like a development placeholder`);
    if (r.check) {
      const err = r.check(v);
      if (err) push(r.key, r.severity, err);
    }
  }

  // Production must not run mock AI, a localhost database, or allow dev features.
  if (production) {
    const db = env.DATABASE_URL ?? '';
    if (db.includes('localhost') || db.includes('127.0.0.1')) push('DATABASE_URL', 'CRITICAL', 'points at localhost — must be a managed production database');
    if ((env.AI_DEFAULT_PROVIDER ?? '').toLowerCase() === 'mock') push('AI_DEFAULT_PROVIDER', 'CRITICAL', 'mock provider selected in production');
    if (env.ALLOW_DEV_FEATURES_IN_PROD === 'true') push('ALLOW_DEV_FEATURES_IN_PROD', 'HIGH', 'development features are force-enabled in production');
    if ((env.FILE_STORAGE_PROVIDER ?? 'local') === 'local') push('FILE_STORAGE_PROVIDER', 'HIGH', 'local file storage is not durable in production');
  }

  const ok = !findings.some((f) => f.severity === 'CRITICAL');
  return { ok, findings, production };
}

/** Throw if production configuration is not safe. Call from a startup/health path. */
export function assertProductionReady(env: NodeJS.ProcessEnv = process.env): void {
  const { ok, findings, production } = validateProductionConfig(env);
  if (production && !ok) {
    const critical = findings.filter((f) => f.severity === 'CRITICAL').map((f) => `${f.key}: ${f.message}`);
    throw new Error(`Production configuration invalid — refusing to start:\n- ${critical.join('\n- ')}`);
  }
}
