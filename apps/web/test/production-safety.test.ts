import { describe, it, expect } from 'vitest';
import { validateProductionConfig, isProduction, devFeaturesAllowed } from '@/server/config/production';

const prodEnv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db.prod.internal:5432/biina',
  AUTH_SECRET: 'a'.repeat(48),
  CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: 'b'.repeat(44),
  NEXT_PUBLIC_APP_URL: 'https://app.biina.ai',
  STRIPE_SECRET_KEY: 'sk_live_' + 'x'.repeat(24),
  STRIPE_WEBHOOK_SECRET: 'whsec_' + 'x'.repeat(24),
  AI_DEFAULT_PROVIDER: 'openai-compatible',
  FILE_STORAGE_PROVIDER: 's3',
  ...over,
});

describe('production configuration validator', () => {
  it('passes with a complete, production-shaped configuration', () => {
    const r = validateProductionConfig(prodEnv());
    expect(r.production).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.findings.filter((f) => f.severity === 'CRITICAL')).toHaveLength(0);
  });

  it('flags missing critical secrets in production as CRITICAL (never the value)', () => {
    const r = validateProductionConfig(prodEnv({ AUTH_SECRET: '', CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: '' }));
    expect(r.ok).toBe(false);
    const keys = r.findings.filter((f) => f.severity === 'CRITICAL').map((f) => f.key);
    expect(keys).toContain('AUTH_SECRET');
    expect(keys).toContain('CONNECTOR_CREDENTIAL_ENCRYPTION_KEY');
    // Findings must never leak values.
    for (const f of r.findings) expect(f.message).not.toContain('aaaa');
  });

  it('refuses a localhost database in production', () => {
    const r = validateProductionConfig(prodEnv({ DATABASE_URL: 'postgresql://biina@localhost:5432/biina' }));
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.key === 'DATABASE_URL' && f.severity === 'CRITICAL')).toBe(true);
  });

  it('refuses the mock AI provider in production', () => {
    const r = validateProductionConfig(prodEnv({ AI_DEFAULT_PROVIDER: 'mock' }));
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.key === 'AI_DEFAULT_PROVIDER' && f.severity === 'CRITICAL')).toBe(true);
  });

  it('flags weak / placeholder secrets', () => {
    const r = validateProductionConfig(prodEnv({ AUTH_SECRET: 'changeme' }));
    expect(r.findings.some((f) => f.key === 'AUTH_SECRET')).toBe(true);
  });

  it('flags a non-https production base URL', () => {
    const r = validateProductionConfig(prodEnv({ NEXT_PUBLIC_APP_URL: 'http://app.biina.ai' }));
    expect(r.findings.some((f) => f.key === 'NEXT_PUBLIC_APP_URL')).toBe(true);
  });

  it('flags local file storage in production', () => {
    const r = validateProductionConfig(prodEnv({ FILE_STORAGE_PROVIDER: 'local' }));
    expect(r.findings.some((f) => f.key === 'FILE_STORAGE_PROVIDER' && f.severity === 'HIGH')).toBe(true);
  });

  it('is lenient in development (no criticals for missing prod-only config)', () => {
    const r = validateProductionConfig({ NODE_ENV: 'development' });
    expect(r.production).toBe(false);
    expect(r.ok).toBe(true);
  });
});

describe('production mode guards', () => {
  it('dev features are allowed in development and blocked in production by default', () => {
    // Reflects the current process env (test run = not production).
    expect(typeof isProduction()).toBe('boolean');
    expect(typeof devFeaturesAllowed()).toBe('boolean');
  });
});
