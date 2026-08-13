/* eslint-disable no-console */
/**
 * `npm run validate:production` — a pre-deploy readiness check. Prints OK / WARNING /
 * BLOCKER for every launch-critical concern WITHOUT ever printing a secret value. It
 * combines the startup config validator with feature-flag / AI / storage / worker /
 * email / billing checks. A BLOCKER means "do not deploy". Exit code is non-zero if any
 * BLOCKER is present (so CI/CD can gate on it).
 */
import { validateProductionConfig, isProduction } from '../src/server/config/production';

type Level = 'OK' | 'WARNING' | 'BLOCKER';
const rows: Array<{ level: Level; area: string; detail: string }> = [];
const add = (level: Level, area: string, detail: string) => rows.push({ level, area, detail });

const env = process.env;
const truthy = (v: string | undefined) => v === 'true' || v === '1';
const present = (k: string) => env[k] != null && env[k] !== '';

// 1) Core config (delegates to the shared validator — never logs values).
const cfg = validateProductionConfig(env);
for (const f of cfg.findings) {
  add(f.severity === 'CRITICAL' ? 'BLOCKER' : f.severity === 'INFO' ? 'OK' : 'WARNING', f.key, f.message);
}
if (!cfg.production) add('WARNING', 'NODE_ENV', 'not production — this validator is intended for a production/staging target');

// 2) AI inference — a real provider + model must be configured (mock is dev-only).
const provider = (env.AI_DEFAULT_PROVIDER ?? '').toLowerCase();
if (!provider) add('BLOCKER', 'AI_DEFAULT_PROVIDER', 'no AI provider configured');
else if (provider === 'mock') add('BLOCKER', 'AI_DEFAULT_PROVIDER', 'mock provider cannot serve real users');
else add('OK', 'AI_DEFAULT_PROVIDER', `provider=${provider}`);
if (provider === 'openai-compatible' && !present('OPENAI_COMPATIBLE_BASE_URL') && !present('AI_BASE_URL_ENV_REF'))
  add('WARNING', 'AI endpoint', 'openai-compatible provider selected but no base URL env is set (set the referenced env var out-of-band)');

// 3) Storage — durable object storage for Files/RAG.
const storage = env.FILE_STORAGE_PROVIDER ?? 'local';
if (storage === 'local') add(isProduction() ? 'BLOCKER' : 'WARNING', 'FILE_STORAGE_PROVIDER', 'local storage is not durable — configure s3/r2 before enabling Files/RAG');
else add('OK', 'FILE_STORAGE_PROVIDER', `storage=${storage}`);

// 4) Worker + scheduler — the workflow tick requires an external caller + shared secret.
if (truthy(env.WORKFLOW_SCHEDULER_ENABLED ?? 'true')) {
  if (!present('WORKFLOW_TICK_SECRET')) add('WARNING', 'WORKFLOW_TICK_SECRET', 'scheduler enabled but no tick secret — scheduled workflows will not run without a secured external tick');
  else add('OK', 'Scheduler', 'tick secret configured');
}

// 5) Email — required for verification/reset/invites.
if (!present('RESEND_API_KEY') && !present('SMTP_URL')) add('WARNING', 'Email', 'no production email provider — verification/reset/invite emails will not be delivered');
else add('OK', 'Email', 'email provider configured');

// 6) Billing — test vs live posture.
if (truthy(env.BILLING_LIVE_MODE)) {
  if (!(env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_')) add('BLOCKER', 'Billing', 'BILLING_LIVE_MODE=true but STRIPE_SECRET_KEY is not a live key');
  else add('OK', 'Billing', 'live mode with a live key');
} else add('OK', 'Billing', 'test mode (safe default until live billing is approved)');

// 7) Feature flags that must be OFF unless explicitly validated for launch.
const shouldBeOff: Array<[string, string]> = [
  ['AGENT_WRITE_ACTIONS_ENABLED', 'external agent writes'],
  ['WORKFLOW_SCHEDULED_WRITES_ENABLED', 'scheduled external writes'],
  ['PUBLIC_LIBRARY_ENABLED', 'public marketplace'],
  ['PUBLIC_CREATOR_PUBLISHING_ENABLED', 'public creator publishing'],
  ['PAID_MARKETPLACE_ENABLED', 'paid marketplace'],
  ['VOICE_MODE_ENABLED', 'voice mode'],
  ['SAML_ENABLED', 'SAML SSO'],
  ['SCIM_ENABLED', 'SCIM provisioning'],
];
for (const [flag, label] of shouldBeOff) {
  if (truthy(env[flag])) add('WARNING', flag, `${label} is ON — confirm it is validated for this launch tier`);
}

// ---- Report ----
const order: Record<Level, number> = { BLOCKER: 0, WARNING: 1, OK: 2 };
rows.sort((a, b) => order[a.level] - order[b.level] || a.area.localeCompare(b.area));
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
console.log('\nBIINA.ai — production configuration validation\n');
for (const r of rows) console.log(`  ${pad(r.level, 8)} ${pad(r.area, 34)} ${r.detail}`);
const blockers = rows.filter((r) => r.level === 'BLOCKER').length;
const warnings = rows.filter((r) => r.level === 'WARNING').length;
console.log(`\n  ${blockers} blocker(s), ${warnings} warning(s).`);
if (blockers > 0) {
  console.log('  ✗ NOT READY TO DEPLOY — resolve blockers first.\n');
  process.exit(1);
}
console.log('  ✓ No blockers. Review warnings before opening access.\n');
