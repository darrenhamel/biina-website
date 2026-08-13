import { randomBytes, createHash, createHmac } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { storageConfig } from './config';

/**
 * Provider-independent file storage. Application logic depends on this interface,
 * never on a vendor. The local dev provider writes OUTSIDE any public/static dir
 * and is only ever read through server code — storage keys and paths are never
 * exposed to the browser. S3/R2/Azure adapters slot in later without touching
 * callers.
 *
 * SECURITY: uploaded bytes are stored and read as OPAQUE data. They are never
 * executed, never rendered as HTML, and never served from a static path. A
 * malware-scanning hook can be inserted at `put` before the object is marked
 * usable (see docs/RAG_SECURITY.md).
 */

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
}

export interface FileStorageProvider {
  readonly name: string;
  /** Store bytes under a server-generated key. Returns the key + size. */
  put(data: Buffer, meta: { extension: string }): Promise<StoredObject>;
  get(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

/** Generate a safe, opaque storage key (never derived from a user filename). */
export function newStorageKey(extension: string): string {
  const ext = extension.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const id = randomBytes(16).toString('hex');
  // Shard by prefix to keep directories small.
  return `${id.slice(0, 2)}/${id}${ext ? `.${ext}` : ''}`;
}

class LocalFileStorage implements FileStorageProvider {
  readonly name = 'local';
  private root: string;
  constructor(root: string) {
    this.root = resolve(process.cwd(), root);
  }
  private full(key: string): string {
    // Guard against path traversal — the resolved path must stay under root.
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + '/') && p !== this.root) throw new Error('invalid storage key');
    return p;
  }
  async put(data: Buffer, meta: { extension: string }): Promise<StoredObject> {
    const key = newStorageKey(meta.extension);
    const path = this.full(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { storageKey: key, sizeBytes: data.length };
  }
  async get(storageKey: string): Promise<Buffer> {
    return readFile(this.full(storageKey));
  }
  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.full(storageKey));
    } catch {
      /* already gone — deletion is idempotent */
    }
  }
  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await mkdir(this.root, { recursive: true });
      await stat(this.root);
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: String(e) };
    }
  }
}

/**
 * S3-compatible object storage (Supabase Storage S3, AWS S3, R2, MinIO, …). Uses
 * path-style addressing + AWS Signature V4 over fetch — no SDK dependency. Objects are
 * PRIVATE: the browser never gets a public URL or the credentials; the app reads bytes
 * server-side and enforces its own authorization. Keys are the same opaque, sharded,
 * non-user-derived keys used everywhere.
 */
export interface S3Config {
  endpoint: string; // e.g. https://<project>.supabase.co/storage/v1/s3
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

class S3FileStorage implements FileStorageProvider {
  readonly name = 's3';
  constructor(private cfg: S3Config) {}

  private objectUrl(key: string): string {
    const base = this.cfg.endpoint.replace(/\/+$/, '');
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${base}/${encodeURIComponent(this.cfg.bucket)}/${encodedKey}`;
  }

  /** Sign + send a single S3 request with SigV4 (payload signed via its SHA-256). */
  private async signedFetch(method: string, url: string, body?: Buffer, contentType?: string): Promise<Response> {
    const u = new URL(url);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
    const headers: Record<string, string> = { host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    if (contentType) headers['content-type'] = contentType;
    const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[Object.keys(headers).find((k) => k.toLowerCase() === h)!].trim()}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalUri = u.pathname.split('/').map((s) => encodeURIComponent(decodeURIComponent(s))).join('/');
    const canonicalQuery = [...u.searchParams.entries()].sort().map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
    const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const signingKey = hmac(hmac(hmac(kDate, this.cfg.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return fetch(url, { method, headers: { ...headers, authorization }, body: body ? new Uint8Array(body) : undefined });
  }

  async put(data: Buffer, meta: { extension: string }): Promise<StoredObject> {
    const key = newStorageKey(meta.extension);
    const res = await this.signedFetch('PUT', this.objectUrl(key), data, 'application/octet-stream');
    if (!res.ok) throw new Error(`storage put failed (${res.status})`);
    return { storageKey: key, sizeBytes: data.length };
  }
  async get(storageKey: string): Promise<Buffer> {
    const res = await this.signedFetch('GET', this.objectUrl(storageKey));
    if (!res.ok) throw new Error(`storage get failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async delete(storageKey: string): Promise<void> {
    const res = await this.signedFetch('DELETE', this.objectUrl(storageKey));
    if (!res.ok && res.status !== 404) throw new Error(`storage delete failed (${res.status})`);
  }
  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      // A signed list with max-keys=1 proves endpoint + credentials without needing an object.
      const base = this.cfg.endpoint.replace(/\/+$/, '');
      const res = await this.signedFetch('GET', `${base}/${encodeURIComponent(this.cfg.bucket)}?list-type=2&max-keys=1`);
      return res.ok ? { ok: true } : { ok: false, detail: `status ${res.status}` };
    } catch (e) {
      return { ok: false, detail: String(e) };
    }
  }
}

export function s3ConfigFromEnv(): S3Config | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.S3_REGION || 'us-east-1' };
}

let cached: FileStorageProvider | null = null;
export function getFileStorage(): FileStorageProvider {
  if (cached) return cached;
  const { provider, localPath } = storageConfig();
  switch (provider) {
    case 's3':
    case 'r2':
    case 'supabase': {
      const cfg = s3ConfigFromEnv();
      if (!cfg) throw new Error('FILE_STORAGE_PROVIDER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.');
      cached = new S3FileStorage(cfg);
      break;
    }
    case 'local':
    default:
      cached = new LocalFileStorage(localPath);
  }
  return cached;
}

/** For tests. */
export function _resetFileStorage(): void {
  cached = null;
}
