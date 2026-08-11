/**
 * Development seed data. Run with: npm run db:seed -w apps/web
 * Creates an admin and a regular user (idempotent on email). Never run in prod.
 *
 * Credentials come from env with safe local defaults:
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_USER_EMAIL / SEED_USER_PASSWORD
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { users, profiles } from '../src/server/db/schema';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema: { users, profiles } });

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
      console.log(`• ${s.email} already exists — skipping`);
      continue;
    }
    const passwordHash = await bcrypt.hash(s.password, 12);
    const [u] = await db.insert(users).values({ email: s.email, passwordHash, role: s.role }).returning({ id: users.id });
    await db.insert(profiles).values({ userId: u.id, displayName: s.displayName });
    console.log(`✓ created ${s.role} ${s.email}`);
  }

  await sql.end();
  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
