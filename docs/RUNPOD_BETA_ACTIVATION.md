# BIINA.ai — RunPod Beta Activation (AI inference)

Operator guide to activate the **production AI inference endpoint** for the invite-only
beta: an **OpenAI-compatible (vLLM)** endpoint on [RunPod](https://www.runpod.io), wired
through the AI Gateway and registered as the logical **"Biina"** model. **BIINA.ai is the
product; the LLM is infrastructure underneath it** — the frontend never learns which model
answered, and the base URL / key never reach the browser.

> **Posture.** `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_API_KEY` are
> **server-side only secrets** — secrets manager / server `.env`, **never committed,
> never sent to the browser, never logged.** The admin model registry references them by
> **env-ref**, so the underlying endpoint stays hidden behind the logical model name. The
> `mock` provider is **refused in production** by `validate:production` (a BLOCKER).

Related: [`RUNPOD_SETUP.md`](./RUNPOD_SETUP.md) (full manual endpoint stand-up) ·
[`AI_PROVIDER_RUNBOOK.md`](./AI_PROVIDER_RUNBOOK.md) (incident response) ·
[`VLLM_DEPLOYMENT.md`](./VLLM_DEPLOYMENT.md) · [`MODEL_ROUTING.md`](./MODEL_ROUTING.md)

---

## What you'll end up with

Server-side environment values (both are secret):

```bash
AI_DEFAULT_PROVIDER=openai-compatible
AI_DEFAULT_MODEL=<your-logical-model-id>      # e.g. biina (the registry entry, not a vendor name)
OPENAI_COMPATIBLE_BASE_URL=__set_out_of_band__
OPENAI_COMPATIBLE_API_KEY=__set_out_of_band__
OPENAI_COMPATIBLE_MODEL=<the served model name>
OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS=120000   # generous, for cold starts
```

---

## 1. Provision the RunPod endpoint — HUMAN ACTION (account / compute purchase)

> **HUMAN ACTION.** Creating the RunPod account, accepting terms, adding
> credits/a payment method, and **renting GPU compute** (which costs money) are
> **human-only**. Claude Code / automation must not create the account, add a card, or
> purchase compute.

Follow [`RUNPOD_SETUP.md`](./RUNPOD_SETUP.md) for the full stand-up. In short:

1. Sign in to RunPod; add billing **only when ready** to run inference.
2. Deploy a **vLLM** OpenAI-compatible endpoint (serverless vLLM worker is fine for beta;
   a dedicated pod avoids cold starts). Pick a GPU sized for your model (a 7–8B model fits
   a 24 GB card; see [`VLLM_DEPLOYMENT.md`](./VLLM_DEPLOYMENT.md)).
3. Select the model to serve and note the **exact served model name**.
4. Set an **API key** on the endpoint and obtain the **base URL** (the OpenAI-compatible
   `/v1` base). The adapter tolerates a base URL that already ends in `/v1`.

---

## 2. Capture the secrets out of band

From the RunPod endpoint settings, capture into the secrets manager (never git, never
chat):

- `OPENAI_COMPATIBLE_BASE_URL` — the endpoint's OpenAI-compatible base URL. **Secret.**
- `OPENAI_COMPATIBLE_API_KEY` — the endpoint API key. **Secret.**
- `OPENAI_COMPATIBLE_MODEL` — the **exact** served model name (must match what the
  endpoint's `/v1/models` reports).

---

## 3. Wire the app environment

Set on the app host / secrets manager (never commit; the base URL and key are secrets):

```bash
AI_DEFAULT_PROVIDER=openai-compatible
AI_DEFAULT_MODEL=<your-logical-model-id>
OPENAI_COMPATIBLE_BASE_URL=__set_out_of_band__
OPENAI_COMPATIBLE_API_KEY=__set_out_of_band__
OPENAI_COMPATIBLE_MODEL=<the served model name>
OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS=120000
```

Restart / redeploy the app so it reads the new environment.

---

## 4. Register the logical "Biina" model

In the admin AI control plane, register the primary logical model **branded "Biina"**:

1. Create a model registry entry with the logical id you set in `AI_DEFAULT_MODEL` and the
   display name **Biina**.
2. Point it at the `openai-compatible` provider, referencing the base URL / key **by
   env-ref** (`OPENAI_COMPATIBLE_BASE_URL` / `OPENAI_COMPATIBLE_API_KEY`) — do not paste
   secret values into the registry record.
3. Set the underlying served model to `OPENAI_COMPATIBLE_MODEL`.
4. Set it as the **default** provider/model so routing selects it as the system default.

> "Biina" is a **logical name** mapping to whatever model the endpoint currently serves.
> The frontend never knows which underlying model answered — you can swap the served model
> later without any frontend/DB change (that is the point of the gateway).

---

## Verify

1. **Admin AI health** (admin session required):

   ```
   GET /api/ai/health
   → provider: openai-compatible · providerConnection: ok · configuredModel: ok
   ```

2. **Probe reply** — in the app, or via a chat request, send:

   ```
   Reply with exactly: Biina.ai cloud AI operational
   ```

   and confirm the reply.

3. **Streaming** — the reply should appear token-by-token, not all at once.

4. **Usage logging** — the server logs an `ai.chat.done` line with `provider`, `model`,
   token counts (when the endpoint returns usage), `ttftMs`, and `latencyMs` — and **no**
   base URL or key.

5. **No secret leakage** — confirm the endpoint URL and key never appear in logs or in any
   API response to the browser.

See [`RUNPOD_SETUP.md`](./RUNPOD_SETUP.md#troubleshooting) for cold-start / auth / model-
mismatch troubleshooting, and [`AI_PROVIDER_RUNBOOK.md`](./AI_PROVIDER_RUNBOOK.md) for
incident response.

---

## What Claude / CI can check

- `npm run validate:production -w apps/web` — `mock` is a **BLOCKER**; a missing
  `AI_DEFAULT_PROVIDER` is a **BLOCKER**; an `openai-compatible` provider with no base URL
  env is a **WARNING**. It never prints a secret value.
- `npm run smoke:production -w apps/web` (with `BASE_URL=https://<app-host>`) — confirms
  the deployment is up and no secret-shaped value leaks in the health payload.

Automation can run these read-only checks. It must **not** create the RunPod account, add
billing, or purchase GPU compute — those are HUMAN ACTIONS.
