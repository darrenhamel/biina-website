/* eslint-disable no-console */
/**
 * Black-box smoke suite for a RUNNING BIINA.ai deployment (staging or production).
 * It makes only outside-in HTTP calls against BASE_URL — no DB access, no secrets, no
 * account creation on the happy path. Exit code is non-zero if any check fails, so it
 * can gate a deploy in CI or a runbook.
 *
 *   BASE_URL=https://staging.biina.ai npm run smoke:staging  -w apps/web
 *   BASE_URL=https://app.biina.ai     npm run smoke:production -w apps/web
 *
 * What it verifies:
 *   1. /api/health is reachable and reports ok (not degraded).
 *   2. Baseline security headers are present (defense-in-depth).
 *   3. The invite-only signup gate is enforced (a non-allowlisted email is refused).
 *   4. No obvious secret leakage in the health payload.
 */

const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const EXPECT_INVITE_ONLY = (process.env.EXPECT_INVITE_ONLY ?? 'true') !== 'false';

type Result = { pass: boolean; name: string; detail: string };
const results: Result[] = [];
const record = (pass: boolean, name: string, detail: string) => results.push({ pass, name, detail });

async function main() {
  if (!BASE_URL) {
    console.error('BASE_URL is required (e.g. BASE_URL=https://app.biina.ai).');
    process.exit(2);
  }
  console.log(`\nBIINA.ai smoke — ${BASE_URL}\n`);

  // 1) Health.
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    record(res.status === 200 && body?.status === 'ok', 'health', `status=${res.status} body.status=${body?.status ?? '?'}`);
    // 4) No secret-shaped strings in the health payload.
    const raw = JSON.stringify(body);
    const leak = /sk_live_|sk_test_|BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?:\/\/|AKIA[0-9A-Z]{16}/.test(raw);
    record(!leak, 'health.no-secret-leak', leak ? 'health payload contains a secret-shaped value' : 'clean');

    // 2) Security headers on a normal response.
    const xcto = res.headers.get('x-content-type-options');
    record(xcto === 'nosniff', 'security-headers', `x-content-type-options=${xcto ?? 'missing'}`);
  } catch (e) {
    record(false, 'health', `unreachable: ${String(e)}`);
  }

  // 3) Invite-only gate. A '.invalid' address can never be on a real allowlist; in
  //    invite_only mode the server must refuse it with 403 and create nothing.
  try {
    const email = `smoke-${randomHex()}@smoke.invalid`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Smoke Test', email, password: 'Sm0ke-Test-Passw0rd!' }),
    });
    if (EXPECT_INVITE_ONLY) {
      record(res.status === 403, 'invite-only-gate', `expected 403, got ${res.status}`);
    } else {
      // Open mode: we don't want to actually create accounts in a smoke run — just note it.
      record(res.status !== 500, 'signup-reachable', `open mode, status=${res.status}`);
    }
  } catch (e) {
    record(false, 'invite-only-gate', `request failed: ${String(e)}`);
  }

  // ---- Report ----
  let failed = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) failed++;
    console.log(`  ${tag}  ${r.name.padEnd(24)} ${r.detail}`);
  }
  console.log(`\n  ${results.length - failed}/${results.length} checks passed.`);
  if (failed > 0) {
    console.log('  ✗ SMOKE FAILED.\n');
    process.exit(1);
  }
  console.log('  ✓ Smoke passed.\n');
}

function randomHex(): string {
  // Node 22 global crypto.
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
