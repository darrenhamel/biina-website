/**
 * RAG configuration (env-driven; non-secret knobs). Providers/vendors are chosen
 * here so the rest of the code depends on abstractions, not vendors.
 */

export function ragEnabledGlobally(): boolean {
  return process.env.RAG_ENABLED !== 'false'; // on by default; plan gating still applies
}

export const embeddingConfig = () => ({
  provider: process.env.EMBEDDING_PROVIDER || 'deterministic',
  model: process.env.EMBEDDING_MODEL || 'biina-dev-embed',
  dimensions: Number(process.env.EMBEDDING_DIMENSIONS) || 256,
});

export const retrievalConfig = () => ({
  topK: clampInt(process.env.RAG_TOP_K, 6, 1, 20),
  minScore: clampFloat(process.env.RAG_MIN_SCORE, 0.15, 0, 1),
  maxContextTokens: clampInt(process.env.RAG_MAX_CONTEXT_TOKENS, 2000, 200, 12000),
});

export const chunkConfig = () => ({
  chunkSize: clampInt(process.env.RAG_CHUNK_SIZE, 1200, 200, 4000), // characters
  chunkOverlap: clampInt(process.env.RAG_CHUNK_OVERLAP, 150, 0, 1000),
});

export const storageConfig = () => ({
  provider: process.env.FILE_STORAGE_PROVIDER || 'local',
  localPath: process.env.FILE_STORAGE_LOCAL_PATH || '.data/uploads',
});

export const vectorStoreKind = () => process.env.VECTOR_STORE || 'portable';

function clampInt(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
}
function clampFloat(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
