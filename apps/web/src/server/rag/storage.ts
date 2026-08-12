import { randomBytes } from 'node:crypto';
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

let cached: FileStorageProvider | null = null;
export function getFileStorage(): FileStorageProvider {
  if (cached) return cached;
  const { provider, localPath } = storageConfig();
  switch (provider) {
    // Future: case 's3' / 'r2' / 'azure' → object-store adapters.
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
