# BIINA.ai — AI Control Plane

The admin surface for controlling BIINA's AI behavior **without code changes**:
which models and providers are active, the default model, persona/workload
routing, fallback, and maintenance.

> **Admin → AI Control** (`/{locale}/app/admin/ai`). Authorization is enforced
> **server-side** on every page and API — hiding the nav link is never the
> control.

---

## What admins can do

- **Overview**: default model, request/error counts, average latency, and a
  **configuration warnings** list (fail-safe conditions surfaced here).
- **Providers**: enable/disable, toggle **maintenance**, view **health** and a
  **redacted** endpoint status (env-var name + "set/not set" — never the value),
  set priority.
- **Models**: enable/disable (soft — records are never deleted), toggle user
  **visibility**, toggle **maintenance**, view capabilities, provider, and the
  underlying infra model (admin-only), set priority.
- **Routing**: choose the **default model**, assign **persona → model** and
  **workload → model**, and configure **fallback** (enabled + fallback model).
- **Recent changes**: an audit trail of who changed what.

Every change is validated (Zod), audited, and invalidates the routing cache so it
takes effect immediately.

## Environment vs. database — the rule

| Kind | Where | Examples |
|---|---|---|
| **Secrets / sensitive** | **ENV only** | API keys, provider base URLs, `AUTH_SECRET` |
| **Operational config** | **Database (admin-editable)** | provider/model enabled, priorities, default model, persona/workload assignments, fallback rules, user-facing names, capabilities, visibility, maintenance |

Provider rows store only the **names** of the env vars that hold secrets
(`base_url_env_ref`, `api_key_env_ref`) plus non-secret state. Admin APIs return
these as `{ envRef, configured: true/false }` — the actual values never leave the
server and are never logged. This is why an admin can enable/route/prioritize a
provider but can never read its key in the browser.

## Security model

- **Authorization**: `requireAdmin()` on every `/api/admin/ai/*` route (401 if
  unauthenticated, 403 if not an admin). Verified by tests + live checks.
- **Input validation**: strict Zod schemas; unknown fields are rejected. Model
  and provider ids are validated; routing maps accept only known model slugs.
- **No secrets in responses or logs**; audit rows record non-secret diffs only.
- **SSRF**: provider endpoints come only from trusted server env — normal users
  cannot submit URLs, and the admin UI does not accept arbitrary URL entry (base
  URLs are env-referenced). See the SSRF note in
  [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- **Persona safety readiness**: the routing control point exists so future policy
  can restrict Kids/Teens to approved models. (The full youth-safety system is a
  later phase.)
- **Sovereign readiness**: providers carry an optional `region` and models a
  `data_residency` field for future data-residency enforcement (unused now).

## Common tasks

**Change the default model** → Routing → *Default model* → Save.

**Enable a model for users** → Models → toggle *Enabled* + *Visible*. It then
appears in the chat model selector (BIINA name only).

**Put a model or provider into maintenance** → toggle *Maintenance*. New requests
won't route to it; in-flight streams are unaffected. Fallback engages if enabled.

**Assign a persona/workload model** → Routing → pick a model for the persona /
workload → Save. Leave "— use default —" to fall back to the default model.

**Turn on fallback** → Routing → enable *Fallback* + pick a fallback model on a
**different** provider → Save. Never silent, never mid-stream, loop-protected.

## Adding a provider or model

- **New provider**: implement the adapter + register the type in
  `@biina/ai-gateway` (see README "Adding another AI provider"), add its secret
  env vars, then insert an `ai_providers` row (slug, type, env refs). It becomes
  controllable in AI Control immediately.
- **New model**: add an `ai_models` row (slug, display name, provider, the vendor
  `provider_model_id`, capabilities). Enable + make visible, or assign it to a
  route. No frontend or gateway change.

Seed data (`npm run db:seed`) creates a working catalog: providers `mock` /
`ollama` / `cloud`, models `BIINA` / `BIINA Fast` / `BIINA Reason` (disabled) /
`BIINA Local` (admin), with the default routed to `BIINA` on whichever provider
your environment currently supports.
