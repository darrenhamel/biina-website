# BIINA.ai — AI Provider Runbook

How to respond to AI provider incidents. BIINA.ai is the product; **LLMs are
infrastructure underneath it** — the frontend never knows which model answered.
Routing is server-authoritative (`src/server/ai/routing.ts`). Every action here
follows **detect → act → verify**.

On-call: `<ops-oncall>` · AI owner: `<ai-platform-owner>`

---

## 0. How routing & fallback actually work (read first)

`selectRoute(ctx, snapshot)` picks a `(model, provider)` by priority:

1. explicit approved model override (user-selected, if allowed)
2. persona route → 3. workload route → 4. plan route → 5. system default model

A candidate is **usable** only if the model **and** its provider are `enabled`
and **not** in `maintenanceMode`, and the model has the required capabilities.
Enterprise policy (`satisfiesEnterprisePolicy`) then **narrows** candidates:
private-provider tenant isolation, external-provider block, region residency,
and org allow-lists. Non-compliant-but-usable candidates are **skipped**, and the
router returns `NO_COMPLIANT_MODEL_AVAILABLE` rather than ever selecting a
prohibited provider.

**Fallback** (`selectFallback`) only fires when:
- `ai_settings.fallbackEnabled` is true, and
- a fallback model exists on a **different provider** than the primary, and
- it is usable, and
- **it also satisfies the same residency/provider policy.**

> There is **no silent fallback to a policy-prohibited provider**. A compliance
> failure is never "rescued" by falling back to an external/out-of-region model.

`ai_settings.maintenanceMode=true` makes `selectRoute` throw immediately (all AI
off; users get a generic 503; admin plane stays reachable).

---

## 1. Provider outage (a whole provider is down)

**Detect** — provider errors/timeouts spike; admin `/api/ai/health` shows the
provider unhealthy; users get 503s if it was the only route.

**Act**
1. Admin → AI control: set the provider's `maintenanceMode=true` (or disable it).
   Routing will skip it and fall through the priority chain.
2. Ensure a healthy default/fallback exists: `validateConfig` (Admin) should show
   no problems. If `fallbackEnabled` and a compliant different-provider fallback
   model is configured, in-flight routing fails over automatically.
3. If **no compliant** alternative exists (e.g. sovereign/UAE-only tenant), do
   **not** widen policy to reach an external provider. Communicate degraded AI
   for those tenants and restore the private provider instead (Section 6).

**Verify** — send a chat; confirm a healthy provider answers; error rate drops.
Re-enable the provider once its health recovers.

---

## 2. Single model unavailable

**Detect** — one model errors while others are fine; `validateConfig` flags a
route pointing at a disabled/missing model.

**Act**
1. Admin → AI control: set that `model.maintenanceMode=true` or `enabled=false`.
2. Re-point any persona/workload/plan route that targeted it to a healthy model.
3. If it was the **default model**, set a new `defaultModelId` — a broken default
   causes `validateConfig` problems and can 503 users.

**Verify** — `validateConfig` clean; requests that used that route now succeed on
the replacement.

---

## 3. Endpoint / base-URL change

Provider base URLs + API keys are **server-side only, never logged, never in git**
(`CLAUDE.md` hard rule). They live in provider config / env.

**Detect** — provider moved endpoints; connection refused / 404 from the gateway.

**Act**
1. Update the provider's base URL / credentials (env or Admin provider record).
2. Restart the web/API tier so new env is picked up (env-sourced values).
3. Re-run the admin AI health check.

**Verify** — `/api/ai/health` healthy for that provider; a live chat succeeds.
Confirm the new URL/key never appears in logs.

---

## 4. Cost spike (provider spend surging)

Cross-reference `COST_CONTROL_RUNBOOK.md`. Quick path:

**Detect** — Admin → Usage & Cost shows spend near/over `dailyCostWarn` /
`monthlyCostWarn`, or budget status `warning`/`critical`/`hard`.

**Act**
1. Identify the driver: which model/workload/user is consuming (Admin usage
   breakdown; logs carry token counts, not secrets).
2. Short-term: route expensive workloads to a cheaper model, or set the pricey
   model to `maintenanceMode`.
3. Enforce the platform hard budget: set `hardLimitEnabled=true` with a
   `dailyCostHardLimit`/`monthlyCostHardLimit`. Billable AI requests then get a
   generic 503; the admin plane stays reachable; in-flight streams are not killed.
4. Clamp runaway automation: agent/research/workflow hard limits (see
   `COST_CONTROL_RUNBOOK.md`).

**Verify** — spend rate flattens; budget status returns toward `normal`.

---

## 5. Fallback behavior verification

When you rely on fallback, confirm it is **policy-respecting**:

1. In Admin, enable fallback and set a fallback model on a **different provider**
   from the default (same-provider or self-reference fallback is a no-op/loop and
   `validateConfig` warns about it).
2. Simulate primary failure (set primary provider `maintenanceMode`).
3. Confirm requests answer via the fallback and `fallbackUsed=true` in the route
   decision / logs.
4. For a sovereign/residency-constrained tenant, confirm fallback is **refused**
   if the only fallback is a prohibited external/out-of-region provider — the
   correct outcome is `NO_COMPLIANT_MODEL_AVAILABLE`, not an external answer.

---

## 6. Private / UAE-sovereign model issue

Sovereign tenants use a deployment profile that blocks external AI/web/connectors
and pins provider regions (e.g. `uae-sovereign` seeds `externalAIAllowed:false`,
`allowedProviderRegions:['UAE']`, private storage/vector required).

**Detect** — sovereign tenant's private model/provider (self-hosted Ollama/vLLM)
is unhealthy; users on that tenant get `NO_COMPLIANT_MODEL_AVAILABLE`.

**Act**
1. Restore the **private** provider — do NOT relax residency to reach a public
   provider. Check the self-hosted inference host (GPU/vLLM/Ollama) health and
   restart it (**REQUIRES INFRA**; see `docs/VLLM_DEPLOYMENT.md`, `RUNPOD_SETUP.md`).
2. If a second in-region private provider exists, ensure it is `enabled` and
   compliant so routing/fallback can use it.
3. Communicate degraded AI to that tenant while the private host recovers.

**Verify** — the private provider is healthy in-region; sovereign tenant chats
succeed with no external provider ever selected (confirm provider region in the
route decision).

---

## Do-not-do
- Never hard-code a model/vendor into the app to "get around" an outage — routing
  is central by design.
- Never widen residency/policy to escape an outage.
- Never log or echo provider base URLs or API keys.
