# BIINA.ai — Personas

A **persona** is the audience a user works as — *Default*, *Campus*, *Professional*,
*Business*, *Government*, and the supervised youth experiences *Kids* / *Teens*. It
tailors presentation, defaults, and the discovery experience, and it feeds the
server-side system prompt. **A persona is a preference, not a permission.** It never
grants capability by itself — entitlements (plan), organization policy, and platform
safety remain authoritative on top of every persona choice. Code:
`apps/web/src/config/personas.ts`, `apps/web/src/config/experience-profiles.ts`,
`apps/web/src/server/experience/service.ts`, `apps/web/src/server/ai/system-prompt.ts`.
Companion docs: [`EXPERIENCE_PROFILES.md`](./EXPERIENCE_PROFILES.md),
[`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md), [`MODEL_ROUTING.md`](./MODEL_ROUTING.md),
[`KIDS_TEENS_EXPERIENCE.md`](./KIDS_TEENS_EXPERIENCE.md).

## One data record, not separate apps

BIINA does **not** build a separate app per audience. Every persona is a **DATA
record** (`personas.ts`) with a richer server-managed **Experience Profile** layered
over it (`experience-profiles.ts`). The app reads the active persona from the user's
profile (`profiles.personaId`) and adapts. Adding or changing a persona is a config
change — never a rebuild. Persona rules live in these config files, never scattered
through React components.

The seven personas (`PersonaId`):

| Persona | `enabled` | Selectable | Audience type | Default model profile |
|---|---|---|---|---|
| **default** | yes | self-select (the new-user default) | GENERAL | `biina` |
| **kids** | no | supervised only (not self-selectable) | YOUTH | `biina-learn` |
| **teens** | no | supervised only (not self-selectable) | YOUTH | `biina-learn` |
| **campus** | yes | self-select | STUDENT | `biina-study` |
| **professional** | yes | self-select | PROFESSIONAL | `biina` |
| **business** | yes | self-select | ENTERPRISE | `biina-business` |
| **government** | yes | self-select | GOVERNMENT | `biina-gov` |

Model profiles (`biina` / `biina-learn` / `biina-study` / `biina-business` /
`biina-gov`) are **logical product identities**, never vendor or model names. They are
resolved by the routing layer ([`MODEL_ROUTING.md`](./MODEL_ROUTING.md)); the frontend
never learns which model answered. Per-specialist / per-persona model routing beyond
the default profile is a later phase (readiness).

## Persona vs plan — separate axes

Persona and **plan** ([`PLANS_AND_ENTITLEMENTS.md`](./PLANS_AND_ENTITLEMENTS.md)) are
independent. A *Campus* user may be on **Free** or **Pro**; a *Business* persona does
not imply an Enterprise plan. The persona chooses *how the product presents itself and
what it recommends*; the plan chooses *what the account is entitled to*. When the two
disagree, the plan wins:

- `resolveActiveExperience(personaId, plan)` returns the requested profile only if the
  plan permits it (`plan.allowedPersonas`; an empty list means all personas allowed).
  A persona the plan does not include falls back to the **default** experience.
- `onboardingChoices(plan)` lists only the directly-selectable profiles the plan
  allows.
- Even when a persona *allows* a capability, that capability is still gated by plan
  entitlement and policy before it is exposed (`profileAllowsCapability` is a
  presentation filter, not an authorization).

## Persona vs organization — separate identity

Persona is the individual's working identity; an **organization**
([`ORGANIZATIONS.md`](./ORGANIZATIONS.md)) is a separate authorization domain. They do
not substitute for one another:

- An organization may set a default experience and curate its library
  ([`ORGANIZATION_LIBRARY.md`](./ORGANIZATION_LIBRARY.md)), but membership — not persona
  — decides what org data a user can reach.
- Selecting the *Government* or *Business* persona grants **no** access to government or
  organization data, private models, compliance, or data-residency guarantees. It only
  changes defaults and tone.
- Tenant isolation is enforced by the org/authorization layers regardless of persona.

## Selection & onboarding

The active experience is a **trusted, server-stored** value on `profiles.personaId`.
The browser cannot claim a privileged experience by sending an id — `setUserExperience`
validates every request:

1. `EXPERIENCE_PROFILES_ENABLED` must be on (else `403 experience_disabled`).
2. The id must be a real profile (else `400 unknown_experience`).
3. The profile must be **directly selectable** — `listSelectableExperienceProfiles()`
   excludes supervised youth (`enabled:false` / `supervisedOnly:true`), so Kids/Teens
   cannot be self-selected (`403 experience_supervised`).
4. The plan must allow it (`plan.allowedPersonas`; else `403 plan_no_experience`).

A successful change writes `personaId` and logs an `experience.changed` security event
(metadata only). API: `GET /api/experience` (active profile + onboarding choices),
`POST /api/experience` (set default). See
[`EXPERIENCE_PROFILES.md`](./EXPERIENCE_PROFILES.md) for the profile fields returned.

## Persona → system prompt

Server-side system-prompt composition (`server/ai/system-prompt.ts`) layers a small
per-persona instruction block (`PERSONA_INSTRUCTIONS`) after the global BIINA policy:

```
Global BIINA policy  +  Persona instructions  +  Personalization/memory  +  Context  +  Conversation
```

These instructions shape **style and defaults only** (e.g. *Kids*: simple, warm,
strictly age-appropriate; *Government*: formal, neutral, sources-grounded, no
unestablished compliance claims). They never widen permissions, never authorize an
action, and the **current explicit user request always takes precedence** over persona
defaults (except where a persona default is itself a safety rule). The prompt is
assembled entirely on the server, is never sent to the browser, and is never persisted
as a visible message — internal prompts are not exposed via any API.

## Persona → ContextEngine & routing

- **ContextEngine** ([`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md)) keeps precedence
  *platform safety > org policy > current request > agent/workflow objective > explicit
  settings > memory > history > retrieval*. The persona sits within defaults/settings;
  it is background shaping, never authority, and it never overrides the request.
- **Model routing** ([`MODEL_ROUTING.md`](./MODEL_ROUTING.md)) reads the persona's
  `defaultModelProfile` as a **preference**. The route is still chosen by the central
  registry with capability gating and plan priority; the persona cannot force a model
  the plan or policy forbids.
- **Memory / web / connector policies** carried on the Experience Profile
  (`memoryPolicy` / `webPolicy` / `connectorPolicy` / `agentPolicy`) reuse the existing
  Phase 9/10/13 controls — they choose *conservative vs standard* defaults, not new
  powers. Details in [`EXPERIENCE_PROFILES.md`](./EXPERIENCE_PROFILES.md).

## Persona is not a security boundary

This is the load-bearing invariant. A persona:

- **is** a presentation + defaults + discovery preference, stored server-side;
- **is not** an authentication, authorization, tenancy, or compliance boundary.

Every real gate — entitlement, org membership, connector scope, tool policy, approval,
tenant isolation — is enforced independently of persona. Choosing *Government* does not
make a deployment sovereign; choosing *Business* does not grant org data; choosing
*Kids* restricts **defaults** but the platform-safety and plan gates are what actually
enforce the youth posture (see [`KIDS_TEENS_EXPERIENCE.md`](./KIDS_TEENS_EXPERIENCE.md)
and [`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md)). Guardian controls, age
verification, and sovereign/government deployment are later phases — persona selection
alone claims none of them.
