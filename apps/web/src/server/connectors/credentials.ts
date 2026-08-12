import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { connectorCredentials } from '@/server/db/schema';
import { encryptCredential, decryptCredential } from './crypto';

/**
 * Credential store — the ONLY place connector secrets are read/written. Callers
 * receive decrypted tokens ONLY inside server code that is about to call a
 * provider; credentials are never returned through an API, logged, or serialized.
 */

export interface OAuthCredential {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number; // epoch ms
}

/** Store (encrypted) the credential for a connection. Overwrites any existing. */
export async function saveCredential(connectionId: string, cred: OAuthCredential): Promise<void> {
  const { ciphertext, keyVersion } = encryptCredential(cred);
  await getDb()
    .insert(connectorCredentials)
    .values({ connectionId, ciphertext, keyVersion })
    .onConflictDoUpdate({ target: connectorCredentials.connectionId, set: { ciphertext, keyVersion, updatedAt: new Date() } });
}

/** Load + decrypt the credential for a connection (server-only). null if none. */
export async function loadCredential(connectionId: string): Promise<OAuthCredential | null> {
  const [row] = await getDb().select().from(connectorCredentials).where(eq(connectorCredentials.connectionId, connectionId)).limit(1);
  if (!row) return null;
  return decryptCredential<OAuthCredential>(row.ciphertext);
}

/** Securely remove a credential (on disconnect/revoke). */
export async function deleteCredential(connectionId: string): Promise<void> {
  await getDb().delete(connectorCredentials).where(eq(connectorCredentials.connectionId, connectionId));
}
