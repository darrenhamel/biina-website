# BIINA.ai — Embeddings Beta Activation (real embedder for RAG)

Operator guide to switch RAG from the **deterministic dev embedder** (a hashed lexical
placeholder, DEV ONLY) to a **real OpenAI-compatible embedder** for the invite-only beta.
RAG retrieval quality depends on a real semantic embedder — the deterministic default is a
production **BLOCKER**. This reuses the existing OpenAI-compatible embedding adapter; no
code change is required.

> **Posture.** `EMBEDDING_API_KEY` (and `EMBEDDING_BASE_URL` if it points somewhere with a
> key) is **server-side only** — secrets manager / server `.env`, **never committed, never
> sent to the browser, never logged.** If unset, the embedder **falls back to**
> `OPENAI_COMPATIBLE_BASE_URL` / `OPENAI_COMPATIBLE_API_KEY` (the same secrets from the AI
> inference endpoint). The deterministic embedder is a **BLOCKER** in production.

Related: [`EMBEDDINGS.md`](./EMBEDDINGS.md) (the abstraction + multilingual guidance) ·
[`VECTOR_STORAGE.md`](./VECTOR_STORAGE.md) · [`RAG_ARCHITECTURE.md`](./RAG_ARCHITECTURE.md) ·
[`RUNPOD_BETA_ACTIVATION.md`](./RUNPOD_BETA_ACTIVATION.md)

---

## What you'll end up with

Server-side environment values (base URL / key are secret if not reusing the AI endpoint's):

```bash
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_MODEL=<the embedding model the endpoint serves>
EMBEDDING_DIMENSIONS=<match the model, e.g. 256>
# Optional — omit to reuse OPENAI_COMPATIBLE_BASE_URL / OPENAI_COMPATIBLE_API_KEY:
EMBEDDING_BASE_URL=__set_out_of_band__
EMBEDDING_API_KEY=__set_out_of_band__
```

---

## 1. Choose the embedder endpoint

You have two honest options for the beta:

| Option | When | Notes |
|---|---|---|
| **Reuse the AI inference endpoint** | The RunPod / vLLM endpoint also serves `/v1/embeddings` for an embedding model | Leave `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` **unset** — they fall back to `OPENAI_COMPATIBLE_*`. |
| **A dedicated embeddings endpoint** | You run a separate OpenAI-compatible embeddings service | Set `EMBEDDING_BASE_URL` + `EMBEDDING_API_KEY` explicitly (both server-side). |

> **HUMAN ACTION** if the embedder needs new paid compute: renting/provisioning it (and any
> billing) is human-only. Reusing an already-provisioned endpoint needs no new purchase.

---

## 2. Choose model + dimensions (get this right the first time)

1. Pick the **embedding model** your endpoint serves; set `EMBEDDING_MODEL` to its exact
   name.
2. Set `EMBEDDING_DIMENSIONS` to **match that model's output dimension** (the adapter
   default is `256`). A mismatch produces broken vectors.
3. For strong **Arabic / cross-lingual** retrieval, prefer a **multilingual** embedding
   model — original text is never translated to build the index, so multilingual quality
   is governed by the model (see [`EMBEDDINGS.md`](./EMBEDDINGS.md#multilingual-guidance)).

> **Re-embedding cost of later changes.** Changing the embedding model **or** dimensions
> later requires **re-embedding every existing document** — vectors from different
> models/dimensions are **not interchangeable**. Each chunk records its `embeddingModel` /
> `embeddingDim`, so a re-embed can detect and regenerate stale vectors, but it is real
> work and spend. **Pick the model and dimensions deliberately now.**

---

## 3. Wire the app environment

Set on the app host / secrets manager (never commit; the base URL / key are secret if set):

```bash
EMBEDDING_PROVIDER=openai-compatible
EMBEDDING_MODEL=<the embedding model the endpoint serves>
EMBEDDING_DIMENSIONS=<match the model>
# Only if NOT reusing the AI endpoint's credentials:
EMBEDDING_BASE_URL=__set_out_of_band__
EMBEDDING_API_KEY=__set_out_of_band__
```

Restart / redeploy the app so it reads the new environment. Confirm `VECTOR_STORE=pgvector`
is set (see [`SUPABASE_PRODUCTION_SETUP.md`](./SUPABASE_PRODUCTION_SETUP.md)).

---

## Verify

1. **Provider is real** — `validate:production` should report
   `EMBEDDING_PROVIDER … embeddings=openai-compatible` (not `deterministic`; see below).

2. **End-to-end RAG in staging** — upload a document, then ask a question whose answer is
   only in that document:
   - Confirm a **relevant** chunk is retrieved and a **citation** renders (deterministic
     lexical retrieval would only match on shared words; a real embedder matches on
     meaning/paraphrase).

3. **Dimension consistency** — new chunks record the configured `embeddingModel` /
   `embeddingDim`. If you later change either, plan a re-embed of existing documents.

4. **No secret leakage** — confirm the embedder base URL / key never appear in logs or in
   any browser-facing response.

---

## What Claude / CI can check

- `npm run validate:production -w apps/web` — `EMBEDDING_PROVIDER=deterministic` is a
  production **BLOCKER**; a real provider reports OK. It also flags a `portable` vector
  store as a WARNING (prefer `pgvector`). It never prints a secret value.
- `npm run smoke:production -w apps/web` (with `BASE_URL=https://<app-host>`) — confirms
  the deployment is up and no secret-shaped value leaks in the health payload.

Automation can run these read-only checks and drive a staging RAG upload. It must **not**
provision new paid embedding compute or add billing — those are HUMAN ACTIONS.
