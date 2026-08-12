/**
 * Development seed data. Run with: npm run db:seed -w apps/web
 * Idempotent. Seeds: an admin + a regular user, and the AI control-plane catalog
 * (providers, models, routes, settings). Never run in prod.
 *
 * Credentials from env with safe local defaults:
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_USER_EMAIL / SEED_USER_PASSWORD
 *
 * The seeded default model reflects the CURRENT environment so the app works out
 * of the box (cloud if OPENAI_COMPATIBLE_* is set, else ollama if selected, else
 * the always-available mock).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import {
  users,
  profiles,
  aiProviders,
  aiModels,
  aiRoutes,
  aiSettings,
  plans,
  commercialPrices,
  billingConfig,
} from '../src/server/db/schema';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  await seedUsers(db);
  await seedAiCatalog(db);
  await seedPlans(db);
  await seedBilling(db);

  await sql.end();
  console.log('Seed complete.');
}

type DB = ReturnType<typeof drizzle>;

async function seedUsers(db: DB) {
  const seeds = [
    {
      email: process.env.SEED_ADMIN_EMAIL || 'admin@biina.local',
      password: process.env.SEED_ADMIN_PASSWORD || 'biina-admin-123',
      displayName: 'BIINA Admin',
      // SUPER_ADMIN so the platform role-change control plane is exercisable locally.
      role: 'SUPER_ADMIN' as const,
    },
    {
      email: process.env.SEED_USER_EMAIL || 'user@biina.local',
      password: process.env.SEED_USER_PASSWORD || 'biina-user-123',
      displayName: 'Test User',
      role: 'USER' as const,
    },
  ];
  for (const s of seeds) {
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, s.email)).limit(1);
    if (existing.length > 0) {
      console.log(`• user ${s.email} exists — skipping`);
      continue;
    }
    const passwordHash = await bcrypt.hash(s.password, 12);
    // Seeded accounts are pre-verified and ACTIVE (status defaults to ACTIVE).
    const [u] = await db
      .insert(users)
      .values({ email: s.email, passwordHash, role: s.role, emailVerified: true })
      .returning({ id: users.id });
    await db.insert(profiles).values({ userId: u.id, displayName: s.displayName });
    console.log(`✓ ${s.role} ${s.email}`);
  }
}

async function seedAiCatalog(db: DB) {
  // Providers (no secrets — only env-var reference names).
  await db
    .insert(aiProviders)
    .values([
      { slug: 'mock', displayName: 'Development (mock)', type: 'mock', enabled: true, priority: 300 },
      {
        slug: 'ollama',
        displayName: 'Local AI (Ollama)',
        type: 'ollama',
        enabled: true,
        priority: 100,
        baseUrlEnvRef: 'OLLAMA_BASE_URL',
        supportsStreaming: true,
        supportsChat: true,
      },
      {
        slug: 'cloud',
        displayName: 'Cloud AI (OpenAI-compatible)',
        type: 'openai-compatible',
        enabled: true,
        priority: 50,
        baseUrlEnvRef: 'OPENAI_COMPATIBLE_BASE_URL',
        apiKeyEnvRef: 'OPENAI_COMPATIBLE_API_KEY',
        supportsStreaming: true,
        supportsChat: true,
      },
    ])
    .onConflictDoNothing({ target: aiProviders.slug });

  const providerRows = await db.select().from(aiProviders);
  const pid = (slug: string) => providerRows.find((p) => p.slug === slug)!.id;

  // Pick the flagship provider from the current environment.
  const cloudReady = Boolean(process.env.OPENAI_COMPATIBLE_BASE_URL && process.env.OPENAI_COMPATIBLE_MODEL);
  const flagship =
    cloudReady
      ? { provider: 'cloud', model: process.env.OPENAI_COMPATIBLE_MODEL as string }
      : process.env.AI_DEFAULT_PROVIDER === 'ollama'
        ? { provider: 'ollama', model: process.env.OLLAMA_MODEL || 'llama3.2:3b' }
        : { provider: 'mock', model: 'biina-dev' };

  // Models (consumer-facing names; infra models hidden behind providerModelId).
  await db
    .insert(aiModels)
    .values([
      {
        slug: 'biina',
        displayName: 'BIINA',
        description: 'The default BIINA model.',
        providerId: pid(flagship.provider),
        providerModelId: flagship.model,
        enabled: true,
        visibleToUsers: true,
        capabilities: { chat: true, streaming: true, reasoning: true, longContext: true },
        priority: 10,
      },
      {
        slug: 'biina-fast',
        displayName: 'BIINA Fast',
        description: 'A quick, lightweight response.',
        providerId: pid('mock'),
        providerModelId: 'biina-dev',
        enabled: true,
        visibleToUsers: true,
        capabilities: { chat: true, streaming: true },
        priority: 20,
      },
      {
        slug: 'biina-reason',
        displayName: 'BIINA Reason',
        description: 'Deeper reasoning (disabled by default — enable in Admin → AI Control).',
        providerId: pid(flagship.provider),
        providerModelId: flagship.model,
        enabled: false,
        visibleToUsers: true,
        capabilities: { chat: true, streaming: true, reasoning: true },
        priority: 30,
      },
      {
        slug: 'biina-local',
        displayName: 'BIINA Local',
        description: 'Local Ollama model (admin/dev).',
        providerId: pid('ollama'),
        providerModelId: process.env.OLLAMA_MODEL || 'llama3.2:3b',
        enabled: true,
        visibleToUsers: false,
        adminOnly: true,
        capabilities: { chat: true, streaming: true },
        priority: 40,
      },
    ])
    .onConflictDoNothing({ target: aiModels.slug });

  const modelRows = await db.select().from(aiModels);
  const mid = (slug: string) => modelRows.find((m) => m.slug === slug)!.id;

  // Settings singleton — default = BIINA, fallback disabled.
  await db
    .insert(aiSettings)
    .values({ id: 'singleton', defaultModelId: mid('biina'), fallbackEnabled: false })
    .onConflictDoUpdate({ target: aiSettings.id, set: { defaultModelId: mid('biina') } });

  // Routes: default persona + workload assignments.
  await db
    .insert(aiRoutes)
    .values([
      { scope: 'persona', scopeKey: 'default', modelId: mid('biina') },
      { scope: 'workload', scopeKey: 'general-chat', modelId: mid('biina') },
      { scope: 'workload', scopeKey: 'fast-chat', modelId: mid('biina-fast') },
      { scope: 'workload', scopeKey: 'reasoning', modelId: mid('biina-reason') },
    ])
    .onConflictDoNothing({ target: [aiRoutes.scope, aiRoutes.scopeKey] });

  // Cost metadata (PLACEHOLDER values — NOT real provider prices). Applied via
  // update so re-running the seed keeps them in sync even if models pre-existed.
  const costs: Record<string, { in: number | null; out: number | null; class: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'PREMIUM' }> = {
    biina: { in: 0.2, out: 0.6, class: 'MEDIUM' },
    'biina-fast': { in: 0.05, out: 0.1, class: 'VERY_LOW' },
    'biina-reason': { in: 0.5, out: 1.5, class: 'HIGH' },
    'biina-local': { in: 0.02, out: 0.02, class: 'LOW' },
  };
  for (const [slug, c] of Object.entries(costs)) {
    await db
      .update(aiModels)
      .set({
        inputCostPerMillion: c.in,
        outputCostPerMillion: c.out,
        costClass: c.class,
        costCurrency: 'USD',
        costSource: 'seed-placeholder',
        costUpdatedAt: new Date(0),
      })
      .where(eq(aiModels.slug, slug));
  }

  console.log(`✓ AI catalog seeded (flagship provider: ${flagship.provider})`);
}

async function seedPlans(db: DB) {
  // Placeholder allowances — INITIAL configuration, not final commercial pricing.
  // null = unlimited for that dimension. Admins edit these in Admin → Plans.
  const rows = [
    {
      slug: 'FREE',
      displayName: 'Free',
      dailyRequestLimit: 50,
      monthlyRequestLimit: 500,
      dailyTokenLimit: 100_000,
      monthlyTokenLimit: 1_000_000,
      requestsPerMinute: 5,
      maxConcurrent: 1,
      maxContextTokens: 8_000,
      maxOutputTokens: 1_024,
      priorityClass: 100,
    },
    {
      slug: 'PRO',
      displayName: 'Pro',
      dailyRequestLimit: 500,
      monthlyRequestLimit: 10_000,
      dailyTokenLimit: 2_000_000,
      monthlyTokenLimit: 30_000_000,
      requestsPerMinute: 20,
      maxConcurrent: 3,
      maxContextTokens: 32_000,
      maxOutputTokens: 4_096,
      priorityClass: 50,
    },
    {
      slug: 'BUSINESS',
      displayName: 'Business',
      dailyRequestLimit: 5_000,
      monthlyRequestLimit: 100_000,
      dailyTokenLimit: 20_000_000,
      monthlyTokenLimit: 300_000_000,
      requestsPerMinute: 60,
      maxConcurrent: 8,
      maxContextTokens: 64_000,
      maxOutputTokens: 8_192,
      priorityClass: 20,
    },
    {
      slug: 'ENTERPRISE',
      displayName: 'Enterprise',
      dailyRequestLimit: null,
      monthlyRequestLimit: null,
      dailyTokenLimit: null,
      monthlyTokenLimit: null,
      requestsPerMinute: 120,
      maxConcurrent: 20,
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
      priorityClass: 10,
    },
    {
      // ADMIN entitlement is expressed through the plan (no unsafe code bypasses):
      // everything unlimited.
      slug: 'ADMIN',
      displayName: 'Admin',
      dailyRequestLimit: null,
      monthlyRequestLimit: null,
      dailyTokenLimit: null,
      monthlyTokenLimit: null,
      requestsPerMinute: null,
      maxConcurrent: null,
      maxContextTokens: null,
      maxOutputTokens: null,
      priorityClass: 0,
    },
  ];
  await db.insert(plans).values(rows).onConflictDoNothing({ target: plans.slug });

  // Phase 8 — files/RAG entitlements per tier (configurable placeholders, not
  // final commercial limits). Applied via update so both fresh and existing DBs
  // get them without clobbering other admin-tuned fields. GB = 1024^3.
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  const rag: Record<string, { files: boolean; rag: boolean; org: boolean; size: number | null; count: number | null; kbs: number | null; storage: number | null }> = {
    FREE: { files: true, rag: true, org: false, size: 5 * MB, count: 5, kbs: 1, storage: 25 * MB },
    PRO: { files: true, rag: true, org: false, size: 25 * MB, count: 100, kbs: 10, storage: 2 * GB },
    BUSINESS: { files: true, rag: true, org: true, size: 50 * MB, count: 1000, kbs: 50, storage: 20 * GB },
    ENTERPRISE: { files: true, rag: true, org: true, size: null, count: null, kbs: null, storage: null },
    ADMIN: { files: true, rag: true, org: true, size: null, count: null, kbs: null, storage: null },
  };
  for (const [slug, r] of Object.entries(rag)) {
    await db
      .update(plans)
      .set({ filesEligible: r.files, ragEnabled: r.rag, orgKnowledgeAccess: r.org, maxFileSizeBytes: r.size, maxFiles: r.count, maxKnowledgeBases: r.kbs, storageBytesLimit: r.storage })
      .where(eq(plans.slug, slug));
  }

  // Give the seeded admin the ADMIN plan (entitlement via plan, not a bypass).
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@biina.local';
  await db.update(users).set({ plan: 'ADMIN' }).where(eq(users.email, adminEmail));

  console.log('✓ plans seeded (FREE/PRO/BUSINESS/ENTERPRISE/ADMIN) + RAG entitlements');
}

/**
 * Seed commercial prices + billing config. Prices are TEST placeholders unless
 * real Stripe price ids are provided via env. `isTest: true` marks them clearly
 * as non-production. Entitlements always come from the plan, never from here.
 */
async function seedBilling(db: DB) {
  // Billing config singleton (UAE-first defaults; tax OFF until verified).
  await db
    .insert(billingConfig)
    .values({ id: 'singleton', defaultCurrency: 'AED', billingCountry: 'AE', taxEnabled: false, taxMode: 'none' })
    .onConflictDoNothing({ target: billingConfig.id });

  const env = process.env;
  const rows = [
    {
      planSlug: 'PRO', displayName: 'Pro — Monthly', currency: 'AED', amount: 4900, billingInterval: 'month' as const,
      providerPriceId: env.STRIPE_PRICE_PRO_MONTHLY || 'price_test_pro_monthly_aed', trialDays: 14,
    },
    {
      planSlug: 'PRO', displayName: 'Pro — Annual', currency: 'AED', amount: 49000, billingInterval: 'year' as const,
      providerPriceId: env.STRIPE_PRICE_PRO_ANNUAL || 'price_test_pro_annual_aed', trialDays: 14,
    },
    {
      planSlug: 'BUSINESS', displayName: 'Business — Monthly', currency: 'AED', amount: 19900, billingInterval: 'month' as const,
      providerPriceId: env.STRIPE_PRICE_BUSINESS_MONTHLY || 'price_test_business_monthly_aed', includedSeats: 5,
    },
    {
      planSlug: 'BUSINESS', displayName: 'Business — Annual', currency: 'AED', amount: 199000, billingInterval: 'year' as const,
      providerPriceId: env.STRIPE_PRICE_BUSINESS_ANNUAL || 'price_test_business_annual_aed', includedSeats: 5,
    },
  ];
  const isTest = !(env.BILLING_LIVE_MODE === 'true');
  for (const r of rows) {
    await db
      .insert(commercialPrices)
      .values({ ...r, isTest, publiclyAvailable: true, enabled: true })
      .onConflictDoNothing({ target: [commercialPrices.billingProvider, commercialPrices.providerPriceId] });
  }
  console.log(`✓ billing seeded (${rows.length} commercial prices${isTest ? ', TEST' : ''})`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
