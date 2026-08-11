# BIINA.ai — vLLM Deployment Guide

How to run an **OpenAI-compatible vLLM** inference server that BIINA connects to
through its `openai-compatible` provider. This is a **recommendation + reference**
— it does **not** provision anything. Nothing here spends money.

> BIINA is not coupled to vLLM or to any host. vLLM is one OpenAI-compatible
> backend; the app only needs a base URL, an (optional) API key, and a model name.

---

## 1. Why vLLM

vLLM exposes an **OpenAI-compatible** HTTP API (`/v1/chat/completions`,
`/v1/models`) with streaming (SSE) and continuous batching for good throughput.
BIINA's `OpenAICompatibleProvider` speaks exactly this API, so no BIINA code
changes are needed to point at a vLLM server.

## 2. Choosing an initial model (start small)

The MVP goal is **inexpensive, capable, responsive, streaming-capable, quick to
start** — *not* a huge model. Sensible starting points (instruction/chat tuned):

| Model | Params | Rough VRAM (fp16) | Notes |
|---|---|---|---|
| `Qwen/Qwen2.5-3B-Instruct` | 3B | ~7–8 GB | Very cheap, fast, bilingual-friendly |
| `Qwen/Qwen2.5-7B-Instruct` | 7B | ~16 GB | Strong default for MVP quality/cost |
| `meta-llama/Llama-3.1-8B-Instruct` | 8B | ~16–18 GB | Popular, gated (accept license) |

Rules: don't deploy a 30B/70B model for initial testing. Keep the model name in
`OPENAI_COMPATIBLE_MODEL` — **never hard-code it in the app**. The customer sees
"BIINA"; the infra model stays behind the gateway.

## 3. VRAM & quantization

- **fp16/bf16**: ~2 GB per 1B params + KV-cache overhead. A 7–8B model fits on a
  **24 GB** GPU (e.g. L4, A10G, RTX 4090) with room for context.
- **Quantization** (AWQ/GPTQ 4-bit) roughly halves weight VRAM, letting a 7–8B
  model run on **12–16 GB** with a small quality trade-off. Use a pre-quantized
  checkpoint and pass `--quantization awq` (or `gptq`).
- Leave headroom for the KV cache; `--gpu-memory-utilization 0.90` is a safe start.

## 4. Context length & concurrency

- `--max-model-len` sets the context window. Start at **8192**; raise only as
  needed — KV-cache memory grows with context × concurrency.
- vLLM batches concurrent requests automatically. Cap with `--max-num-seqs`
  (e.g. `16`) to bound memory under load.
- Concurrency vs. context is a memory trade-off: long context + high concurrency
  needs more VRAM. Size the GPU for `max-model-len × max-num-seqs`.

## 5. Startup parameters (reference)

```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name Qwen/Qwen2.5-7B-Instruct \
  --host 0.0.0.0 --port 8000 \
  --max-model-len 8192 \
  --max-num-seqs 16 \
  --gpu-memory-utilization 0.90 \
  --api-key "$VLLM_API_KEY"          # enables Bearer auth on the endpoint
  # --quantization awq               # if using a quantized checkpoint
```

Container form (pinned image, GPU):

```bash
docker run --gpus all -p 8000:8000 \
  -e HF_TOKEN="$HF_TOKEN" \                 # only for gated models
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct \
  --max-model-len 8192 --max-num-seqs 16 \
  --gpu-memory-utilization 0.90 \
  --api-key "$VLLM_API_KEY"
```

## 6. API authentication

Passing `--api-key` makes vLLM require `Authorization: Bearer <key>`. BIINA sends
this automatically when `OPENAI_COMPATIBLE_API_KEY` is set. For a **private**
network endpoint you may run without a key; BIINA then sends no auth header. Keep
the key **server-side only** — it lives in the BIINA server environment, never in
the browser, never in git.

## 7. Health checking

- `GET /v1/models` — returns the served model(s); BIINA's admin diagnostics use
  this to confirm reachability **and** that `OPENAI_COMPATIBLE_MODEL` exists.
- vLLM also serves `GET /health` (200 when ready).
- BIINA surface: admin-only `GET /api/ai/health` (see README) reports
  `providerConnection` and `configuredModel` without exposing the URL or key.

## 8. Cold start & serverless vs. persistent

- **Persistent GPU (dedicated pod):** always warm, lowest latency, highest cost
  (pay while idle). Best for steady traffic.
- **Serverless GPU (e.g. RunPod Serverless):** scales to zero, cheap when idle,
  but **cold starts** (model load can take tens of seconds to minutes). BIINA
  handles this gracefully: the request may hit a timeout or a `provider_unavailable`
  and the user sees "temporarily unavailable, try again" — set
  `OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS` generously (e.g. 120000) to ride out warm-ups.
- Start serverless for MVP economics; move to a persistent pod when latency matters.

## 9. Scaling considerations

- vLLM scales **vertically** (bigger GPU, more concurrency) and **horizontally**
  (multiple replicas behind a load balancer). BIINA points at one base URL — put a
  load balancer in front of replicas and BIINA is unchanged.
- Because BIINA app containers are stateless (state is in Postgres), you can scale
  the app and the inference tier independently.

## 10. Connecting BIINA

Set in the BIINA **server** environment (see `.env.example`) — no code change:

```bash
AI_DEFAULT_PROVIDER=openai-compatible
AI_DEFAULT_MODEL=biina-general
OPENAI_COMPATIBLE_BASE_URL=http://<vllm-host>:8000
OPENAI_COMPATIBLE_API_KEY=<VLLM_API_KEY>          # omit if the endpoint is unauthenticated
OPENAI_COMPATIBLE_MODEL=Qwen/Qwen2.5-7B-Instruct  # must match --served-model-name
```

Then restart BIINA and verify via `GET /api/ai/health` (admin). For a hosted
serverless GPU, see [`RUNPOD_SETUP.md`](./RUNPOD_SETUP.md).
