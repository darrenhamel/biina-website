/* eslint-disable no-console */
/**
 * PRODUCTION-SAFE seed. Seeds ONLY essential, non-secret system data:
 *   - the plan catalog + entitlements
 *   - baseline deployment profiles
 *   - core AI settings singleton (no mock provider, no secrets)
 *
 * It creates NO test users, NO seeded admin with a default password, NO mock AI
 * provider, NO test billing prices, NO test library items. The first platform admin
 * is created out-of-band with scripts/bootstrap-admin.ts (promotes a real signed-up
 * user). Official curated library items are seeded post-bootstrap, attributed to that
 * admin. Refuses to run against an obviously development database.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { plans, deploymentProfiles } from '../src/server/db/schema';
import { validateProductionConfig } from '../src/server/config/production';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required.');

// A production seed must not silently run against localhost unless explicitly allowed.
if ((url.includes('localhost') || url.includes('127.0.0.1')) && process.env.ALLOW_LOCAL_PROD_SEED !== 'true') {
  throw new Error('DATABASE_URL points at localhost. Refusing to run the production seed (set ALLOW_LOCAL_PROD_SEED=true to override for a test).');
}

const cfg = validateProductionConfig();
const criticals = cfg.findings.filter((f) => f.severity === 'CRITICAL');
if (criticals.length) {
  console.error('Refusing to seed: critical production configuration problems:');
  for (const c of criticals) console.error(`  - ${c.key}: ${c.message}`);
  process.exit(1);
}

const PLANS: Array<{ slug: string; displayName: string }> = [
  { slug: 'FREE', displayName: 'Free' },
  { slug: 'PRO', displayName: 'Pro' },
  { slug: 'BUSINESS', displayName: 'Business' },
  { slug: 'ENTERPRISE', displayName: 'Enterprise' },
  { slug: 'ADMIN', displayName: 'Admin' },
];

async function main() {
  const sql = postgres(url!, { max: 4 });
  const db = drizzle(sql);
  try {
    // Ensure the plan rows exist (entitlement columns keep their schema defaults; an
    // operator tunes them via the admin plan editor, never via committed secrets).
    for (const p of PLANS) {
      const [existing] = await db.select({ slug: plans.slug }).from(plans).where(eq(plans.slug, p.slug)).limit(1);
      if (!existing) await db.insert(plans).values({ slug: p.slug, displayName: p.displayName });
    }

    // Baseline deployment profiles (shared SaaS + a privileged UAE sovereign template).
    const profiles = [
      { slug: 'shared-saas', displayName: 'Shared SaaS', deploymentType: 'SHARED_SAAS' as const, region: 'OTHER', privileged: false },
      { slug: 'uae-sovereign', displayName: 'UAE Sovereign (readiness)', deploymentType: 'SOVEREIGN' as const, region: 'UAE', privileged: true, externalAIAllowed: false, externalWebSearchAllowed: false, externalConnectorsAllowed: false, allowedProviderRegions: ['UAE'], privateStorageRequired: true, privateVectorStoreRequired: true, jurisdictionLabel: 'United Arab Emirates' },
    ];
    for (const pr of profiles) {
      const [existing] = await db.select({ id: deploymentProfiles.id }).from(deploymentProfiles).where(eq(deploymentProfiles.slug, pr.slug)).limit(1);
      if (!existing) await db.insert(deploymentProfiles).values(pr);
    }

    console.log('✓ production seed complete: plans + deployment profiles. No test users, admins, providers, or billing were created.');
    console.log('  Next: sign up the first admin, then run `tsx scripts/bootstrap-admin.ts` with BOOTSTRAP_ADMIN_EMAIL set.');
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
