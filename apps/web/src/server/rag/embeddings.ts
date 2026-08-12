import { createHash } from 'node:crypto';
import { embeddingConfig } from './config';

/**
 * Provider-independent embeddings. The rest of RAG depends on this interface,
 * never on a vendor. Adapters:
 *  - `deterministic` (default here): a cheap, LOCAL, dependency-free embedder —
 *    hashed bag-of-words into a fixed dimension, L2-normalized. It needs no model
 *    or network, is deterministic, and gives functional lexical similarity so the
 *    full pipeline runs and tests end-to-end. It is NOT a semantic model — real
 *    deployments configure Ollama or an OpenAI-compatible embeddings endpoint.
 *  - `ollama` / `openai-compatible`: real embeddings over HTTP (fetch), server-side.
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

/** Deterministic hashed-bag-of-words embedder (dev/test default). */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'deterministic';
  readonly model: string;
  readonly dimensions: number;
  constructor(model = 'biina-dev-embed', dimensions = 256) {
    this.model = model;
    this.dimensions = dimensions;
  }
  private embedOne(text: string): number[] {
    const vec = new Array(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const tok of tokens) {
      // Two hashed buckets per token with signed contributions → richer signal.
      const h = createHash('md5').update(tok).digest();
      const b1 = ((h[0] << 8) | h[1]) % this.dimensions;
      const b2 = ((h[2] << 8) | h[3]) % this.dimensions;
      vec[b1] += 1;
      vec[b2] += h[4] % 2 === 0 ? 1 : -1;
    }
    return l2normalize(vec);
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
  async health() {
    return { ok: true, detail: 'deterministic dev embedder' };
  }
}

/** Ollama embeddings via HTTP (server-side). */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly model: string;
  readonly dimensions: number;
  private baseUrl: string;
  constructor(model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
    this.baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
  }
  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const input of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: input }),
      });
      if (!res.ok) throw new Error(`Ollama embeddings failed (${res.status})`);
      const json = (await res.json()) as { embedding?: number[] };
      if (!json.embedding) throw new Error('Ollama returned no embedding');
      out.push(json.embedding);
    }
    return out;
  }
  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, detail: String(e) };
    }
  }
}

/** OpenAI-compatible embeddings (vLLM / cloud) via HTTP (server-side). */
export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-compatible';
  readonly model: string;
  readonly dimensions: number;
  private baseUrl: string;
  private apiKey?: string;
  constructor(model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
    this.baseUrl = (process.env.EMBEDDING_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL || '').replace(/\/$/, '');
    this.apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_COMPATIBLE_API_KEY;
  }
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.baseUrl) throw new Error('Embedding base URL not configured');
    const url = this.baseUrl.endsWith('/v1') ? `${this.baseUrl}/embeddings` : `${this.baseUrl}/v1/embeddings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`Embeddings failed (${res.status})`);
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    if (!json.data) throw new Error('Embedding response missing data');
    return json.data.map((d) => d.embedding);
  }
  async health() {
    return { ok: Boolean(this.baseUrl), detail: this.baseUrl ? undefined : 'not configured' };
  }
}

let cached: EmbeddingProvider | null = null;
let override: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (override) return override;
  if (cached) return cached;
  const { provider, model, dimensions } = embeddingConfig();
  switch (provider) {
    case 'ollama':
      cached = new OllamaEmbeddingProvider(model, dimensions);
      break;
    case 'openai-compatible':
      cached = new OpenAICompatibleEmbeddingProvider(model, dimensions);
      break;
    case 'deterministic':
    default:
      cached = new DeterministicEmbeddingProvider(model, dimensions);
  }
  return cached;
}

/** Test hook — inject a fake embedding provider. */
export function setEmbeddingProvider(p: EmbeddingProvider | null): void {
  override = p;
  cached = null;
}
