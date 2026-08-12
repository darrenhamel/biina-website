# BIINA.ai — Experience Profiles

An **Experience Profile** is the server-managed layer over a persona
([`PERSONAS.md`](./PERSONAS.md)). It is the single data record that decides how the
product presents itself to an audience: navigation, home starters, which product
capabilities are surfaced, the recommended model profile, and the memory / web /
connector / agent / marketplace **posture**. It changes **defaults and presentation —
never the security boundary**. Code: `apps/web/src/config/experience-profiles.ts`.
Companion docs: [`PERSONAS.md`](./PERSONAS.md), [`MODEL_ROUTING.md`](./MODEL_ROUTING.md),
[`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md),
[`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md),
[`KIDS_TEENS_EXPERIENCE.md`](./KIDS_TEENS_EXPERIENCE.md).

## The pipeline

```
User → Experience Profile → ContextEngine → Entitlements + Policy → Model Routing → BIINA capabilities
```

A profile expresses **intent**; every layer to its right can still narrow it. A profile
that *allows* connectors on a plan without connectors, or an org that disables them,
yields no connectors. Nothing a profile says grants access.

## The fields

`ExperienceProfile` (per `PersonaId`):

| Field | Meaning |
|---|---|
| `id` / `slug` | persona id + stable slug |
| `audienceType` | `GENERAL` / `YOUTH` / `STUDENT` / `PROFESSIONAL` / `ENTERPRISE` / `GOVERNMENT` |
| `enabled` | directly selectable during onboarding |
| `supervisedOnly` | youth experiences requiring guardian/age handling — not self-selectable |
| `defaultForNewUsers` | the profile new accounts start on (**default**) |
| `defaultModelProfile` | logical **product** model identity (`biina` / `biina-learn` / `biina-study` / `biina-business` / `biina-gov`) — never a vendor/model name; resolved by routing |
| `systemProfileKey` | key into the server-managed persona system-prompt block |
| `allowedCapabilities` | product capabilities the persona **may** expose (still plan/policy/safety-gated) |
| `recommendedCapabilities` | capabilities surfaced first in the UI |
| `navigation` | ordered primary nav (subset of `NavKey`, still entitlement-gated) |
| `home` | home-screen starter actions (i18n label keys; route / library / template) |
| `memoryPolicy` | `CONSERVATIVE` / `STANDARD` / `ORG` |
| `webPolicy` | `STRICT_SAFE` / `SAFE` / `STANDARD` |
| `connectorPolicy` | `DISABLED` / `PERSONAL` / `ORG_POLICY` |
| `agentPolicy` | `DISABLED` / `LIMITED` / `STANDARD` / `ORG_POLICY` |
| `marketplace` | `CURATED_KIDS` / `CURATED_TEENS` / `STANDARD` / `CURATED_ONLY` |
| `recommendedCategories` | library category slugs recommended for this persona |
| `ageBand` / `accent` / `label` | minimal display metadata (EN/AR labels) |

`ProductCapability` vocabulary: `chat`, `knowledge`, `files`, `web`, `research`,
`agents`, `automations`, `connectors`, `vision`, `voice`, `memory`, `library`,
`publicLibrary`. These are **product** capabilities (what the UI surfaces), distinct
from *model* capabilities.

## The seven profiles

| Profile | Model | Memory | Web | Connectors | Agents | Marketplace |
|---|---|---|---|---|---|---|
| **default** | `biina` | STANDARD | STANDARD | PERSONAL | STANDARD | STANDARD |
| **kids** | `biina-learn` | CONSERVATIVE | STRICT_SAFE | DISABLED | DISABLED | CURATED_KIDS |
| **teens** | `biina-learn` | CONSERVATIVE | SAFE | DISABLED | LIMITED | CURATED_TEENS |
| **campus** | `biina-study` | STANDARD | SAFE | PERSONAL | LIMITED | STANDARD |
| **professional** | `biina` | STANDARD | STANDARD | PERSONAL | STANDARD | STANDARD |
| **business** | `biina-business` | ORG | STANDARD | ORG_POLICY | ORG_POLICY | STANDARD |
| **government** | `biina-gov` | ORG | STANDARD | ORG_POLICY | ORG_POLICY | CURATED_ONLY |

Highlights:

- **default** — the neutral GENERAL experience, all capabilities allowed, the new-user
  default.
- **kids** / **teens** — deliberately minimal, supervised, `enabled:false`. Kids allows
  only `chat`/`knowledge`/`library`; Teens adds `files`/`web`/`research`. See
  [`KIDS_TEENS_EXPERIENCE.md`](./KIDS_TEENS_EXPERIENCE.md).
- **campus** — study-oriented; research/knowledge/chat recommended; `LIMITED` agents.
- **professional** — full knowledge-work surface; automations recommended.
- **business** — org-centric defaults (`ORG` memory, `ORG_POLICY` connectors/agents);
  knowledge/agents/automations recommended.
- **government** — formal defaults with `CURATED_ONLY` marketplace so sensitive
  deployments can be restricted to platform/organization-approved items. This is a
  **readiness posture**, not a sovereignty or compliance claim.

## Capability policies reuse existing controls

The `*Policy` fields do **not** introduce new engines — they select conservative vs
standard **defaults** over machinery already built:

- **memoryPolicy** → the Phase 13 memory + ContextEngine posture
  ([`MEMORY_ARCHITECTURE.md`](./MEMORY_ARCHITECTURE.md),
  [`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md)). `CONSERVATIVE` for youth, `ORG` for
  org-centric personas; consent + plan gating still apply.
- **webPolicy** → the Phase 9 web-grounding posture
  ([`WEB_GROUNDING.md`](./WEB_GROUNDING.md), [`WEB_SECURITY.md`](./WEB_SECURITY.md)).
  `STRICT_SAFE` / `SAFE` express safe-search defaults; SSRF and injection defenses are
  unconditional regardless of profile.
- **connectorPolicy** → the Phase 10 connector model
  ([`CONNECTOR_SECURITY.md`](./CONNECTOR_SECURITY.md)). `DISABLED` for youth; `PERSONAL`
  vs `ORG_POLICY` chooses the default authority domain; every scope is still OAuth- and
  policy-gated.
- **agentPolicy** → the Phase 11/12 agent + workflow controls
  ([`AGENT_ARCHITECTURE.md`](./AGENT_ARCHITECTURE.md), [`WORKFLOWS.md`](./WORKFLOWS.md)).
  A profile can disable/limit agents by default, never widen approvals.
- **marketplace** → the library visibility/discovery posture
  ([`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md)); curated-only surfaces for
  youth and sensitive deployments.

## Navigation & home config

`navigation` gives each persona an ordered primary-nav subset (from the shared `NavKey`
set in `config/navigation.ts`); every entry is still entitlement-gated, so a disabled
area renders as a placeholder rather than a rebuild. `home` is a small list of
`HomeAction`s — an i18n `labelKey` (resolved under `experience.home.*`, never English in
config), a `target`, and a `kind` of `route` | `library` | `template`. Example: Campus
starters point at chat, the *explain-a-concept* and *practice-questions* templates, and
research. Labels are always resolved in the UI so EN/AR/RTL stays correct.

## Admin experience controls

- `EXPERIENCE_PROFILES_ENABLED` (env, default **true**) is the master switch; when off,
  `setUserExperience` refuses and the product stays on the default experience.
- Profiles are **code-defined data**, reviewed like any config change — there is no
  runtime editor that could let an item or a persona widen its own capabilities.
- Plan-level `allowedPersonas` (empty = all) restricts which profiles a plan can select;
  `resolveActiveExperience` and `onboardingChoices` enforce it. See
  [`PLANS_AND_ENTITLEMENTS.md`](./PLANS_AND_ENTITLEMENTS.md).
- The public API (`GET /api/experience`) returns only display-safe fields (id, slug,
  label, audienceType, defaultModelProfile, navigation, home, capabilities,
  recommendedCategories, accent) — never internal policy internals or system-prompt
  text.

Every profile change is validated server-side and logged as `experience.changed`
(metadata only). A profile is a preference; it is **not** a security boundary — see
[`PERSONAS.md`](./PERSONAS.md#persona-is-not-a-security-boundary).
