# BIINA.ai — Model Routing

How BIINA decides **which model on which provider** answers each request, and how
that stays decoupled from the UI and from vendor infrastructure.

---

## The four distinct concepts

BIINA deliberately separates things that are often conflated:

| Concept | Example | Where it lives |
|---|---|---|
| **Provider** | `cloud` (an OpenAI-compatible endpoint) | `ai_providers` (DB) + secrets in ENV |
| **Underlying model** | `Qwen/Qwen2.5-7B-Instruct` | `ai_models.provider_model_id` (DB) |
| **BIINA model (logical)** | `biina-general` | `ai_models.slug` (DB) |
| **Consumer display name** | `BIINA` | `ai_models.display_name` (DB) |

A normal user sees **"BIINA"**. They never see the provider, the vLLM/Ollama
detail, or the infra model name. Admins see all of it in Admin → AI Control.

## The routing sequence

```
Browser
  ↓  POST /api/ai/chat   (message + optional approved model slug + optional workload)
Server AI Service
  ↓  build RouteContext { userId, userPlan, isAdmin, persona, workload, requestedModel }
Routing Engine  (pure function over a cached DB snapshot)  ← decides WHERE
  ↓  RouteDecision { providerType, providerModel, biinaModel, reason, fallback }
@biina/ai-gateway  Provider Router                          ← decides HOW
  ↓  getProvider(providerType).chat({ model: providerModel, … })
Ollama | OpenAI-compatible (vLLM/RunPod)
  ↓  normalized stream → Browser
```

- **Routing Engine** (`apps/web/src/server/ai/routing.ts`) = *where to send it*.
- **Provider Router** (`packages/ai-gateway`) = *how to talk to that provider*.
  Connection secrets (base URL, API key) come from **ENV**, keyed by provider type.

## Routing priority

The engine evaluates candidates in this order and uses the first **usable** one:

1. **Explicit model override** — a user-selected, *approved & visible* BIINA model.
   An override for a disabled/hidden model is a clear error (unless admin).
2. **Persona route** — e.g. `kids → BIINA Safe`.
3. **Workload route** — e.g. `fast-chat → BIINA Fast`.
4. **Plan route** — e.g. `FREE → BIINA Fast` (readiness; no billing yet).
5. **System default model**.

"Usable" means: model enabled & not in maintenance, its provider enabled & not in
maintenance, and the model's **capabilities** satisfy the request's required
capabilities (workloads declare requirements — e.g. `reasoning` needs the
`reasoning` capability). Unusable candidates are skipped; if none remain, routing
**fails clearly** (see Fail-safe).

## Capabilities

Standardized flags per model: `chat`, `streaming`, `reasoning`, `tools`,
`vision`, `files`, `structuredOutput`, `longContext`. Routing rejects any route
that cannot satisfy the required capabilities — BIINA never pretends a model can
do something it can't.

## Fallback (opt-in, never silent)

Configured by admins (`ai_settings.fallback_enabled` + a fallback model). It
engages **only**:

- before any token has streamed (no duplicate generation / no duplicate cost),
- for defined failures (provider unavailable, pre-stream timeout, model
  unavailable, overload), **or** proactively when the primary provider's stored
  health is `error`,
- to a **different** provider than the primary (loop-protected; never to itself).

Every failover logs an `ai.routing.failover` event. Fallback is **off by default**.

## Provider health

Providers carry a `health_state` (`ok`/`error`/`degraded`/`unknown`), refreshed
when an admin opens AI Control (live probe) and marked on runtime outcomes.
Routing consults it for proactive fallback; it never auto-switches unless
fallback is enabled.

## Fail-safe behavior

Invalid configuration does **not** route unpredictably — it fails clearly and is
surfaced to admins (Admin → AI Control shows a warnings list via
`validateConfig`). Detected conditions include: no default model, default
disabled/using a disabled provider, a persona/workload route referencing a
missing/disabled model, and a self-referential fallback. Normal users always get
a generic "temporarily unavailable" message; the technical reason is logged with
the request id.

## What a normal user can (and cannot) influence

- **Can**: hint a `workload` and request an **approved, visible** BIINA model slug.
- **Cannot**: set plan, persona-as-privilege, provider, URL, or infra model —
  those come from the authenticated session or server config only. All request
  values are Zod-validated; a model id can never become a URL or vendor model.

See [`AI_CONTROL_PLANE.md`](./AI_CONTROL_PLANE.md) for the admin controls and the
env-vs-database split.
