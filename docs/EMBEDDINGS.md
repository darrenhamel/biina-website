# BIINA.ai — Embeddings

Embeddings turn chunk text and queries into vectors so the vector store can rank
relevance. As everywhere in BIINA, the embedding model is **infrastructure behind
an interface** — not hard-coded, chosen by env. Companion docs:
`VECTOR_STORAGE.md`, `RAG_ARCHITECTURE.md`. Code: `apps/web/src/server/rag/
embeddings.ts`.

## The abstraction

An `EmbeddingProvider` (plus a `cosineSimilarity` helper) is selected by a factory
from env; tests inject a provider via `setEmbeddingProvider`.

| Adapter | Real? | What it is |
|---|---|---|
| `DeterministicEmbeddingProvider` | dev default | cheap, local, dependency-free hashed **bag-of-words** → fixed dim, L2-normalized |
| `OllamaEmbeddingProvider` | real | Ollama `/api/embeddings` |
| `OpenAICompatibleEmbeddingProvider` | real | OpenAI-compatible `/v1/embeddings`, server-side key |

## The deterministic dev default — honest about what it is

The default `DeterministicEmbeddingProvider` is a **hashed lexical embedder**, not
a semantic model. It is:

- **Dependency-free and local** — no Ollama, no API key, no network. This is why
  the entire RAG pipeline runs and is tested in any environment (including this
  one, which has neither Ollama nor `pgvector`).
- **Functional lexical similarity** — it clusters documents that share words, so
  the pipeline produces plausible retrievals for tests and demos.
- **NOT semantic** — it does not understand meaning, paraphrase, or synonymy, and
  it is clearly labeled as such. **Production must configure a real embedding
  provider** (Ollama or OpenAI-compatible).

## Configuration (env)

| Variable | Purpose |
|---|---|
| `EMBEDDING_PROVIDER` | `deterministic` (default) · `ollama` · `openai-compatible` |
| `EMBEDDING_MODEL` | model id for the chosen provider |
| `EMBEDDING_DIMENSIONS` | vector dimension (must match the model) |

Provider base URLs and API keys stay **server-side only**, never logged — the same
posture as the chat providers (see `SECURITY.md`).

## Per-chunk model metadata

Every chunk records the `embeddingModel` and `embeddingDim` used to produce its
vector (plus `embeddingStatus`). This is what makes safe **model migration**
possible: a re-embed can detect vectors produced by a different model/dimension
and regenerate them, because vectors from different models/dims are **not
interchangeable** (see `VECTOR_STORAGE.md`).

## Cost accounting readiness

Embedding cost accounting reuses the Phase 5 honesty rule: **never invent a cost**.

- A **local** embedder (deterministic / self-hosted Ollama) has no per-token
  vendor price, so no cost is fabricated.
- A metered provider records **provider + model** per chunk, so real
  cost/attribution can be layered on without re-indexing when needed.

## Multilingual guidance

- **Original text is preserved** — Arabic is **never translated** to build the
  index. What governs multilingual quality is the **embedding model**, not any
  translation step.
- The deterministic dev embedder is **language-agnostic lexical** (it matches on
  shared tokens), so it works across languages but shallowly.
- **Production should pick a multilingual embedding model** for strong Arabic /
  cross-lingual retrieval.
- RTL rendering of filenames, titles, snippets, and citations is handled in the UI
  (see `KNOWLEDGE_BASES.md`).
