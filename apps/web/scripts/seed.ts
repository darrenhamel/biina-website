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
      role: 'ADMIN' as const,
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
    const [u] = await db.insert(users).values({ email: s.email, passwordHash, role: s.role }).returning({ id: users.id });
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

  console.log(`✓ AI catalog seeded (flagship provider: ${flagship.provider})`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
