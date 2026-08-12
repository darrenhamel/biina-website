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
  connectorDefinitions,
  voiceProfiles,
} from '../src/server/db/schema';
import { DEFAULT_VOICES } from '../src/server/media/voices';

const MEDIA_VOICES = DEFAULT_VOICES;

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
  await seedConnectors(db);

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

  // Phase 9 — web-search entitlements per tier (configurable placeholders).
  const web: Record<string, { on: boolean; day: number | null; month: number | null; sources: number | null; fresh: boolean }> = {
    FREE: { on: true, day: 10, month: 100, sources: 3, fresh: false },
    PRO: { on: true, day: 100, month: 2000, sources: 5, fresh: true },
    BUSINESS: { on: true, day: 500, month: 10000, sources: 6, fresh: true },
    ENTERPRISE: { on: true, day: null, month: null, sources: 8, fresh: true },
    ADMIN: { on: true, day: null, month: null, sources: 8, fresh: true },
  };
  for (const [slug, w] of Object.entries(web)) {
    await db
      .update(plans)
      .set({ webSearchEligible: w.on, webSearchEnabled: w.on, dailyWebSearches: w.day, monthlyWebSearches: w.month, maxSourcesPerRequest: w.sources, freshnessFiltersEnabled: w.fresh })
      .where(eq(plans.slug, slug));
  }

  // Phase 10 — connector entitlements per tier (configurable placeholders).
  const conn: Record<string, { on: boolean; personal: number | null; org: number | null; day: number | null; month: number | null }> = {
    FREE: { on: false, personal: 0, org: 0, day: 0, month: 0 },
    PRO: { on: true, personal: 5, org: 0, day: 50, month: 500 },
    BUSINESS: { on: true, personal: 10, org: 20, day: 500, month: 5000 },
    ENTERPRISE: { on: true, personal: null, org: null, day: null, month: null },
    ADMIN: { on: true, personal: null, org: null, day: null, month: null },
  };
  for (const [slug, c] of Object.entries(conn)) {
    await db
      .update(plans)
      .set({ connectorsEnabled: c.on, maxPersonalConnections: c.personal, maxOrganizationConnections: c.org, connectedSearchDailyLimit: c.day, connectedSearchMonthlyLimit: c.month })
      .where(eq(plans.slug, slug));
  }

  // Phase 11 — agent entitlements per tier. Conservative: FREE has no agent.
  const agent: Record<string, { on: boolean; day: number | null; month: number | null; steps: number | null; writes: number | null; msgs: number | null }> = {
    FREE: { on: false, day: 0, month: 0, steps: 0, writes: 0, msgs: 0 },
    PRO: { on: true, day: 20, month: 200, steps: 8, writes: 25, msgs: 25 },
    BUSINESS: { on: true, day: 100, month: 2000, steps: 12, writes: 200, msgs: 100 },
    ENTERPRISE: { on: true, day: null, month: null, steps: 15, writes: null, msgs: null },
    ADMIN: { on: true, day: null, month: null, steps: 20, writes: null, msgs: null },
  };
  for (const [slug, a] of Object.entries(agent)) {
    await db
      .update(plans)
      .set({ agentEnabled: a.on, agentSessionsDailyLimit: a.day, agentSessionsMonthlyLimit: a.month, agentMaxStepsPerSession: a.steps, agentWriteActionsDailyLimit: a.writes, agentExternalMessagesDailyLimit: a.msgs })
      .where(eq(plans.slug, slug));
  }

  // Phase 12 — workflow/automation entitlements per tier. FREE has no workflows.
  const wf: Record<string, { on: boolean; active: number | null; sched: boolean; cond: boolean; runs: number | null; steps: number | null; writes: boolean }> = {
    FREE: { on: false, active: 0, sched: false, cond: false, runs: 0, steps: 0, writes: false },
    PRO: { on: true, active: 5, sched: true, cond: true, runs: 300, steps: 8, writes: false },
    BUSINESS: { on: true, active: 25, sched: true, cond: true, runs: 3000, steps: 12, writes: true },
    ENTERPRISE: { on: true, active: null, sched: true, cond: true, runs: null, steps: 15, writes: true },
    ADMIN: { on: true, active: null, sched: true, cond: true, runs: null, steps: 20, writes: true },
  };
  for (const [slug, w] of Object.entries(wf)) {
    await db
      .update(plans)
      .set({ workflowsEnabled: w.on, maxActiveWorkflows: w.active, scheduledAutomationsEnabled: w.sched, conditionAutomationsEnabled: w.cond, workflowRunsPerMonth: w.runs, maxWorkflowSteps: w.steps, scheduledWritesEnabled: w.writes })
      .where(eq(plans.slug, slug));
  }

  // Phase 13 — memory & personalization entitlements per tier. FREE = manual-only.
  const mem: Record<string, { on: boolean; max: number | null; auto: boolean; org: boolean; retention: number | null }> = {
    FREE: { on: true, max: 20, auto: false, org: false, retention: null },
    PRO: { on: true, max: 200, auto: true, org: false, retention: null },
    BUSINESS: { on: true, max: 1000, auto: true, org: true, retention: 365 },
    ENTERPRISE: { on: true, max: null, auto: true, org: true, retention: null },
    ADMIN: { on: true, max: null, auto: true, org: true, retention: null },
  };
  for (const [slug, m] of Object.entries(mem)) {
    await db
      .update(plans)
      .set({ memoryEnabled: m.on, maxMemories: m.max, autoMemoryEnabled: m.auto, organizationMemoryEnabled: m.org, memoryRetentionDays: m.retention })
      .where(eq(plans.slug, slug));
  }

  // Phase 14 — multimodal entitlements per tier. FREE has vision only (limited).
  const mm: Record<string, { vision: boolean; imgReq: number | null; imgDay: number | null; ocr: boolean; ocrMo: number | null; stt: boolean; audMin: number | null; tts: boolean; ttsCh: number | null; voice: boolean; vMin: number | null; store: number | null }> = {
    FREE: { vision: true, imgReq: 2, imgDay: 10, ocr: true, ocrMo: 20, stt: false, audMin: 0, tts: false, ttsCh: 0, voice: false, vMin: 0, store: 100 * MB },
    PRO: { vision: true, imgReq: 6, imgDay: 200, ocr: true, ocrMo: 500, stt: true, audMin: 300, tts: true, ttsCh: 200000, voice: true, vMin: 120, store: 5 * GB },
    BUSINESS: { vision: true, imgReq: 10, imgDay: 2000, ocr: true, ocrMo: 5000, stt: true, audMin: 3000, tts: true, ttsCh: 2000000, voice: true, vMin: 1000, store: 50 * GB },
    ENTERPRISE: { vision: true, imgReq: 20, imgDay: null, ocr: true, ocrMo: null, stt: true, audMin: null, tts: true, ttsCh: null, voice: true, vMin: null, store: null },
    ADMIN: { vision: true, imgReq: 20, imgDay: null, ocr: true, ocrMo: null, stt: true, audMin: null, tts: true, ttsCh: null, voice: true, vMin: null, store: null },
  };
  for (const [slug, m] of Object.entries(mm)) {
    await db
      .update(plans)
      .set({ visionEnabled: m.vision, maxImagesPerRequest: m.imgReq, imageUploadsPerDay: m.imgDay, ocrEnabled: m.ocr, ocrPagesPerMonth: m.ocrMo, speechToTextEnabled: m.stt, audioMinutesPerMonth: m.audMin, textToSpeechEnabled: m.tts, ttsCharactersPerMonth: m.ttsCh, voiceModeEnabled: m.voice, voiceMinutesPerMonth: m.vMin, mediaStorageBytesLimit: m.store })
      .where(eq(plans.slug, slug));
  }

  // Phase 14 — seed the logical voice registry (English + Arabic).
  for (const v of MEDIA_VOICES) {
    await db.insert(voiceProfiles).values(v).onConflictDoNothing();
  }

  // Phase 15 — advanced research entitlements per tier. FREE has none.
  const rs: Record<string, { on: boolean; deep: boolean; runs: number | null; tasks: number | null; sources: number | null; parallel: number | null; cost: number | null }> = {
    FREE: { on: false, deep: false, runs: 0, tasks: 0, sources: 0, parallel: 0, cost: 0 },
    PRO: { on: true, deep: false, runs: 20, tasks: 4, sources: 16, parallel: 3, cost: 2 },
    BUSINESS: { on: true, deep: true, runs: 200, tasks: 6, sources: 30, parallel: 3, cost: 10 },
    ENTERPRISE: { on: true, deep: true, runs: null, tasks: 8, sources: 40, parallel: 4, cost: null },
    ADMIN: { on: true, deep: true, runs: null, tasks: 8, sources: 40, parallel: 4, cost: null },
  };
  for (const [slug, r] of Object.entries(rs)) {
    await db
      .update(plans)
      .set({ advancedResearchEnabled: r.on, deepResearchEnabled: r.deep, researchRunsPerMonth: r.runs, maxResearchTasks: r.tasks, maxSourcesPerResearch: r.sources, maxParallelAgents: r.parallel, maxResearchCost: r.cost })
      .where(eq(plans.slug, slug));
  }

  // Give the seeded admin the ADMIN plan (entitlement via plan, not a bypass).
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@biina.local';
  await db.update(users).set({ plan: 'ADMIN' }).where(eq(users.email, adminEmail));

  console.log('✓ plans seeded (FREE/PRO/BUSINESS/ENTERPRISE/ADMIN) + RAG/web/connector/agent/workflow/memory/multimodal/research entitlements + voices');
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

/**
 * Seed the connector registry (SAFE metadata only — never secrets). The 'mock'
 * connector is enabled so the framework is exercisable out of the box; real
 * providers are DISABLED until OAuth credentials are configured (see
 * docs/CONNECTOR_ACTIVATION_CHECKLIST.md).
 */
async function seedConnectors(db: DB) {
  const G = (s: string) => `https://www.googleapis.com/auth/${s}`;
  const rows = [
    { slug: 'mock', displayName: 'Demo Connector', providerType: 'mock', category: 'Other', enabled: true, supportsOAuth: true, supportsPersonal: true, supportsOrganization: true, capabilities: ['SEARCH', 'READ'], scopes: [] as string[] },
    { slug: 'google-drive', displayName: 'Google Drive', providerType: 'google', category: 'File Storage', enabled: false, supportsOAuth: true, supportsPersonal: true, supportsOrganization: true, capabilities: ['SEARCH', 'LIST', 'READ', 'DOWNLOAD'], scopes: ['openid', 'email', 'profile', G('drive.readonly')] },
    { slug: 'gmail', displayName: 'Gmail', providerType: 'google', category: 'Email', enabled: false, supportsOAuth: true, supportsPersonal: true, supportsOrganization: false, capabilities: ['SEARCH', 'READ'], scopes: ['openid', 'email', 'profile', G('gmail.readonly')] },
    { slug: 'google-calendar', displayName: 'Google Calendar', providerType: 'google', category: 'Calendar', enabled: false, supportsOAuth: true, supportsPersonal: true, supportsOrganization: false, capabilities: ['LIST', 'SEARCH', 'READ'], scopes: ['openid', 'email', 'profile', G('calendar.readonly')] },
    { slug: 'slack', displayName: 'Slack', providerType: 'slack', category: 'Communication', enabled: false, supportsOAuth: true, supportsPersonal: false, supportsOrganization: true, capabilities: ['SEARCH', 'READ'], scopes: ['search:read', 'channels:history'] },
  ];
  for (const r of rows) {
    await db.insert(connectorDefinitions).values(r).onConflictDoNothing({ target: connectorDefinitions.slug });
  }
  console.log(`✓ connectors seeded (${rows.length}; mock enabled, real providers disabled until OAuth configured)`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
