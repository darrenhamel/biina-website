import { randomBytes, createHash } from 'node:crypto';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { emailTokens } from '@/server/db/schema';

/**
 * Email verification + password-reset tokens.
 *
 * Tokens are cryptographically random; only their SHA-256 HASH is stored, so a
 * DB leak can't be used to verify/reset. They EXPIRE and are SINGLE-USE, consumed
 * atomically (UPDATE ... WHERE used_at IS NULL RETURNING) so two concurrent
 * requests can't both succeed. The raw token is returned once, to the caller.
 */

type TokenType = 'verify' | 'reset';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const TTL_MS: Record<TokenType, number> = {
  verify: 24 * 60 * 60 * 1000, // 24h
  reset: 60 * 60 * 1000, // 1h
};

/** Create a token of a type for a user. Returns the RAW token (store nothing else). */
export async function createEmailToken(userId: string, type: TokenType): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await getDb().insert(emailTokens).values({
    userId,
    type,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + TTL_MS[type]),
  });
  return token;
}

/**
 * Atomically consume a valid, unused, unexpired token of the given type.
 * Returns the userId on success, or null. Single-use is enforced by the
 * `used_at IS NULL` guard in the UPDATE.
 */
export async function consumeEmailToken(token: string, type: TokenType): Promise<string | null> {
  const rows = await getDb()
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, hash(token)),
        eq(emailTokens.type, type),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: emailTokens.userId });
  return rows[0]?.userId ?? null;
}

/** Invalidate all outstanding tokens of a type for a user (e.g. after use). */
export async function invalidateTokens(userId: string, type: TokenType): Promise<void> {
  await getDb()
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)));
}
