import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Application-level credential encryption (AES-256-GCM). Connector OAuth tokens /
 * API keys are encrypted at rest with a server-only key; the ciphertext is the
 * ONLY thing stored, and it is never serialized to an API, logged, or put in a
 * prompt. The key comes from CONNECTOR_CREDENTIAL_ENCRYPTION_KEY (do NOT generate
 * a new one per restart — that would orphan every stored credential).
 *
 * Format: `v<keyVersion>:<iv-b64>:<tag-b64>:<data-b64>`. `keyVersion` lets a
 * future key rotation re-encrypt lazily; a managed KMS (AWS/GCP/Azure/Vault) can
 * later replace this module without changing callers (see CONNECTOR_SECURITY.md).
 */

const KEY_VERSION = 1;

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new CredentialCryptoError('CONNECTOR_CREDENTIAL_ENCRYPTION_KEY is not set');
  // Accept a 32-byte base64 key directly, or derive one from a passphrase.
  let k: Buffer;
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) k = b64;
  else k = scryptSync(raw, 'biina-connector-credentials', 32);
  cachedKey = k;
  return k;
}

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

/** Encrypt a JSON-serializable credential object → opaque ciphertext string. */
export function encryptCredential(plain: unknown): { ciphertext: string; keyVersion: number } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: `v${KEY_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`, keyVersion: KEY_VERSION };
}

/** Decrypt ciphertext → credential object. Throws on tamper/wrong key. */
export function decryptCredential<T = Record<string, unknown>>(ciphertext: string): T {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || !parts[0].startsWith('v')) throw new CredentialCryptoError('malformed ciphertext');
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return JSON.parse(out.toString('utf8')) as T;
  } catch {
    // Wrong key or tampered ciphertext — fail safe, never expose detail.
    throw new CredentialCryptoError('credential decryption failed');
  }
}

/** For tests — reset the cached key after changing the env var. */
export function _resetCredentialKey(): void {
  cachedKey = null;
}
