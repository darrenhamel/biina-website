# BIINA.ai — Vector Storage

RAG needs somewhere to store chunk embeddings and rank them by similarity. Like
the AI gateway and the billing provider, this is an **abstraction with a portable
default and a documented production path** — swapping it changes no ownership,
ingestion, chat, or gateway code. Companion docs: `EMBEDDINGS.md`,
`RAG_ARCHITECTURE.md`, `RAG_SECURITY.md`. Code: `apps/web/src/server/rag/
vector-store.ts`.

## The abstraction

```
retrieval / ingestion  →  VectorStore interface  →  PortableVectorStore (default)
                                                  ↘  PgVectorStore (production)
                                                  ↘  Qdrant / Pinecone / Weaviate (future)
```

`VectorStore` methods: `upsert`, `deleteByDocument`, `similaritySearch`,
`health`. Every adapter honors the **same isolation contract** (below), so the
rest of the system is unaware which store is active (`VECTOR_STORE` env).

## Default: `PortableVectorStore` (jsonb)

The default stores each embedding as a **jsonb float array** in
`document_chunks.embedding` and ranks candidates by **cosine similarity** in
application code over the tenant-filtered candidate set.

Why this is the default:

- **No `pgvector` extension required** — runs on any stock PostgreSQL 16, so the
  whole pipeline runs and is tested anywhere, including this environment.
- Correct and simple; the ranking is exact cosine over a **scope-filtered** set,
  not an approximate index.

Trade-off: it scans the tenant's candidate chunks per query, which is fine at the
plan-bounded scale of the MVP but is not an ANN index — hence the production path.

## Isolation contract (all adapters)

`similaritySearch` filters by the **trusted scope in the query itself**, never a
global search filtered afterward:

```
knowledgeBaseIds  AND  (organizationId = ?  XOR  ownerUserId = ? AND organizationId IS NULL)
```

Org A can never retrieve Org B's chunks even at identical similarity, because the
foreign rows are **never candidates**. Chunks carry **denormalized**
`organizationId` / `ownerUserId` so this filter is a cheap indexed predicate. See
`RAG_SECURITY.md`.

## Production path: `pgvector`

Moving to `pgvector` is additive and touches **only** the store layer:

1. Provision the `vector` extension on the database.
2. Add a `vector` column alongside (or replacing) the jsonb column.
3. Build an **ANN index** (e.g. HNSW / IVFFlat) for fast approximate search.
4. Enable the `PgVectorStore` adapter (`VECTOR_STORE=pgvector`) behind the same
   `VectorStore` interface and the same in-query scope filter.

**No change** to knowledge ownership, ingestion, the chat route, or the AI
gateway — only the adapter. Recommended for production once corpora grow.

## Future stores

Dedicated vector databases (**Qdrant**, **Pinecone**, **Weaviate**) slot in as
further `VectorStore` adapters. Each must implement the same scope-filtered
`similaritySearch` so tenant isolation is preserved regardless of backend.

## Embedding-model migration & re-embedding

Vectors from **different models or dimensions are not interchangeable** — cosine
similarity across mismatched spaces is meaningless. Therefore each chunk stores
its `embeddingModel` and `embeddingDim` alongside the vector:

- A re-embed can **detect mismatches** (model/dim differs from the configured
  provider) and re-process affected chunks.
- Changing `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` in production is a **re-embed
  operation**, not a hot swap — old vectors must be regenerated before they're
  comparable to new queries.

## Indexing notes

- Chunk rows are indexed by `documentId`, `knowledgeBaseId`, `organizationId`,
  `ownerUserId`, and `embeddingStatus` — the isolation filter and ingestion
  bookkeeping both ride these indexes.
- `deleteByDocument` removes a document's vectors atomically so deletion leaves no
  searchable remnant (see `FILES.md`).
