import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users, profiles } from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { createSession } from '@/server/auth/session';
import { signupSchema } from '@/lib/validation';
import { ok, badRequest, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { displayName, email, password } = signupSchema.parse(body);
    const db = getDb();

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return badRequest('An account with that email already exists.');
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id });
    await db.insert(profiles).values({ userId: user.id, displayName });

    await createSession(user.id);
    return ok({ ok: true }, { status: 201 });
  } catch (err) {
    return handleError(err, 'auth.signup');
  }
}
