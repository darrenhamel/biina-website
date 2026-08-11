import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { users } from '@/server/db/schema';
import { verifyPassword } from '@/server/auth/password';
import { createSession } from '@/server/auth/session';
import { loginSchema } from '@/lib/validation';
import { ok, unauthorized, handleError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = loginSchema.parse(body);
    const db = getDb();

    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Same generic response whether the email exists or the password is wrong.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return unauthorized('Incorrect email or password.');
    }

    await createSession(user.id);
    return ok({ ok: true });
  } catch (err) {
    return handleError(err, 'auth.login');
  }
}
