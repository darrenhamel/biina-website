/* eslint-disable no-console */
/**
 * Secure first-admin bootstrap. Promotes an EXISTING, already-signed-up user to
 * SUPER_ADMIN + the ADMIN plan. It never creates a user and never sets a password —
 * there are NO hard-coded admin credentials anywhere in the product. Run once, by an
 * operator, with BOOTSTRAP_ADMIN_EMAIL set to the real person's account email.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { users } from '../src/server/db/schema';

const url = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
if (!url) throw new Error('DATABASE_URL is required.');
if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required (the email of an already-signed-up user to promote).');

async function main() {
  const sql = postgres(url!, { max: 2 });
  const db = drizzle(sql);
  try {
    const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email!.toLowerCase())).limit(1);
    if (!user) {
      console.error(`No user found with email ${email}. Ask them to sign up first, then re-run.`);
      process.exit(1);
    }
    await db.update(users).set({ role: 'SUPER_ADMIN', plan: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, user.id));
    console.log(`✓ ${email} promoted to SUPER_ADMIN + ADMIN plan. Enforce MFA on this account where available.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
