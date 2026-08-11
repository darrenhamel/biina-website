# BIINA.ai — RunPod Setup (manual, human-only)

Step-by-step for standing up an **OpenAI-compatible vLLM** endpoint on
[RunPod](https://www.runpod.io) and connecting BIINA to it.

> **RunPod is infrastructure, not part of BIINA's code.** BIINA needs only a base
> URL, an API key, and a model name. Nothing here is automated — **you** perform
> these steps and BIINA has no code coupling to RunPod. Renting GPUs costs money;
> do it only when you're ready. Do not paste real keys into git — use the
> placeholders shown as `<...>`.

---

## What you'll end up with

Three values for the BIINA server environment:

```
OPENAI_COMPATIBLE_BASE_URL=<your endpoint URL>
OPENAI_COMPATIBLE_API_KEY=<your secret key>
OPENAI_COMPATIBLE_MODEL=<the served model name>
```

## Checklist

1. **Create / sign in to a RunPod account** at runpod.io.
2. **Add billing only when ready.** No GPU is rented until you deploy one. Add
   credits/a card only at the point you intend to run inference.
3. **Choose an architecture:**
   - **Serverless (vLLM)** — scales to zero, cheapest when idle, has cold starts.
     Best for MVP. RunPod offers a ready **vLLM** serverless worker.
   - **Dedicated Pod** — always-on GPU, no cold start, costs while idle. Choose
     this later if latency matters.
4. **Select a suitable GPU class.** For a 7–8B model start with a **24 GB** card
   (e.g. L4 / A10 / RTX 4090). A quantized 7–8B fits on 12–16 GB. Avoid large
   (30B/70B) GPUs for the MVP. See [`VLLM_DEPLOYMENT.md`](./VLLM_DEPLOYMENT.md).
5. **Deploy vLLM-compatible inference.** Use RunPod's vLLM worker/template (it
   exposes the OpenAI-compatible API), or a Pod running `vllm/vllm-openai`.
6. **Select the model** (e.g. `Qwen/Qwen2.5-7B-Instruct`). For gated models add
   your Hugging Face token (`HF_TOKEN`) in the worker/pod environment. Note the
   exact **served model name** — it must match `OPENAI_COMPATIBLE_MODEL`.
7. **Configure authentication.** Set an API key on the endpoint (RunPod provides
   one for serverless; for a Pod, pass vLLM `--api-key`). This becomes
   `OPENAI_COMPATIBLE_API_KEY`. Keep it secret.
8. **Obtain the endpoint URL** (`OPENAI_COMPATIBLE_BASE_URL`):
   - **Serverless** OpenAI-compatible base is typically
     `https://api.runpod.ai/v2/<ENDPOINT_ID>/openai/v1`
     (BIINA tolerates a base URL that already ends in `/v1`).
   - **Pod**: your pod's public URL + port, e.g. `https://<pod-id>-8000.proxy.runpod.net`.
9. **Obtain the API credential** from the RunPod endpoint/account settings.
10. **Insert credentials into the BIINA server environment** (never the browser,
    never git):
    ```bash
    AI_DEFAULT_PROVIDER=openai-compatible
    AI_DEFAULT_MODEL=biina-general
    OPENAI_COMPATIBLE_BASE_URL=<endpoint URL>
    OPENAI_COMPATIBLE_API_KEY=<secret>
    OPENAI_COMPATIBLE_MODEL=<served model name>
    OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS=120000   # generous, for cold starts
    ```
11. **Restart / redeploy BIINA** so it reads the new environment.
12. **Run the health check** (as an ADMIN user):
    ```
    GET /api/ai/health
    → provider: openai-compatible · providerConnection: ok · configuredModel: ok
    ```
13. **Run a test conversation** in the app, or send this exact probe and confirm
    the reply:
    ```
    Reply with exactly: Biina.ai cloud AI operational
    ```
14. **Verify streaming** — the reply should appear token-by-token, not all at once.
15. **Verify usage logging** — the server logs an `ai.chat.done` line with
    `provider`, `model`, `inputTokens`/`outputTokens`/`totalTokens` (when the
    endpoint returns usage), `ttftMs`, and `latencyMs`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `providerConnection: error`, "endpoint unreachable" | wrong base URL / endpoint asleep | check URL; serverless may be cold — retry |
| `configuredModel: missing` | `OPENAI_COMPATIBLE_MODEL` ≠ served name | match it to `/v1/models` output |
| chat returns 503 "temporarily unavailable" | cold start / worker unavailable / timeout | raise `OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS`; retry |
| `invalid_config` / auth failed | wrong or missing API key | re-copy `OPENAI_COMPATIBLE_API_KEY` |
| first request very slow | serverless cold start (model loading) | expected; consider a warm/dedicated pod |

## Security notes

- The API key stays **server-side only**; it is never sent to the browser or
  logged. Do not commit it.
- Users cannot choose the endpoint — the base URL comes only from trusted server
  configuration (see the SSRF note in [`ARCHITECTURE.md`](./ARCHITECTURE.md)).
- Prefer an authenticated endpoint. If you run an unauthenticated private
  endpoint, keep it on a private network, not the public internet.
