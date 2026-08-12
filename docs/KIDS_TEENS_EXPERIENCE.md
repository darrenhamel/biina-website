# BIINA.ai — Kids & Teens Experience

The **Kids** and **Teens** experiences are deliberately controlled, supervised
profiles focused on **learning and creativity**. They are the most locked-down personas:
disabled by default (`enabled:false`), **not self-selectable** (`supervisedOnly:true`),
and restricted by profile **and** by every gate in
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md). This document describes what ships today
and what is honestly **readiness**. Code: `apps/web/src/config/personas.ts`,
`experience-profiles.ts`, `server/ai/system-prompt.ts`. Companion docs:
[`PERSONAS.md`](./PERSONAS.md), [`EXPERIENCE_PROFILES.md`](./EXPERIENCE_PROFILES.md),
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md).

## Kids

Audience `YOUTH`, model profile `biina-learn`. Deliberately minimal:

- **Allowed capabilities**: `chat`, `knowledge`, `library` only — **no** files, web,
  research, agents, automations, connectors, vision, voice, or unrestricted memory.
- **connectorPolicy `DISABLED`** — no external app connections.
- **agentPolicy `DISABLED`** — no installable agents or automations.
- **webPolicy `STRICT_SAFE`** — the strictest safe-search default.
- **memoryPolicy `CONSERVATIVE`** — minimal, conservative memory defaults.
- **marketplace `CURATED_KIDS`** — only the curated Kids library; **no public
  marketplace**, no external writes.
- **Navigation**: `chat`, `discover` only; home starters point at chat and curated Learn
  / Create / Explore categories.
- **System prompt** (`PERSONA_INSTRUCTIONS.kids`, server-side): simple, warm, encouraging
  language; strictly age-appropriate, safe, educational; never unsafe/mature/frightening;
  gently redirects inappropriate requests; **does not ask for personal information**;
  short, easy answers.

## Teens

Audience `YOUTH`, model profile `biina-learn`. Stronger than Kids, weaker than an adult
experience:

- **Allowed capabilities**: `chat`, `knowledge`, `files`, `web`, `research`, `library`.
- **connectorPolicy `DISABLED`**; **agentPolicy `LIMITED`** (not full agents).
- **webPolicy `SAFE`** — safe-search, less strict than Kids' `STRICT_SAFE`.
- **memoryPolicy `CONSERVATIVE`**; **marketplace `CURATED_TEENS`** — a controlled
  marketplace, not the open one.
- **Navigation**: `chat`, `knowledge`, `research`, `discover`; home starters emphasize
  study, research, and writing.
- **System prompt** (`PERSONA_INSTRUCTIONS.teens`): clear, respectful; emphasizes
  learning, study skills, research, critical thinking, and citing sources; keeps content
  age-appropriate; redirects inappropriate requests.

## Curated Kids / Teens libraries

Youth categories are seeded in `CATEGORY_SEEDS` and persona-scoped so only youth
personas surface them: Kids sees `learn`, `read`, `create`, `explore`, `stories`,
`math`, `science`, `languages`; Teens adds `study`, `writing`, `career`, `creativity`.
The marketplace posture (`CURATED_KIDS` / `CURATED_TEENS`) means these audiences see
only curated content — the public marketplace is never surfaced to them, and youth plans
do not enable write-capable agent/workflow libraries, so a youth account **cannot install
a business write agent** (see the matrix in
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md#security-test-matrix)).

## Why the youth posture actually holds

Youth safety does **not** rest on persona selection alone (persona is not a security
boundary — [`PERSONAS.md`](./PERSONAS.md#persona-is-not-a-security-boundary)). It holds
because:

- youth profiles are `supervisedOnly` and **cannot be self-selected** — `setUserExperience`
  refuses them (`403 experience_supervised`);
- disabled connectors/agents mean there is no external-action surface to reach;
- `STRICT_SAFE` / `SAFE` web defaults sit on the Phase 9 web controls;
- curated-only marketplace + plan gating block installing write-capable executables;
- the deterministic library review + runtime policy gates apply regardless of persona.

## Readiness — stated honestly

The following are **not built** in Phase 16 and must not be claimed:

- **Age-band handling** — Kids `ageBand` is `6–12` (the profile notes 4–7 / 8–12 as the
  intended split) and Teens `13–17`, but there is **no age verification**. Age bands are
  minimal metadata, not an enforced check.
- **Guardian ↔ child controls** — the model is *no surveillance*: there is no guardian
  dashboard, consent flow, or child-monitoring feature. Guardian setup (which is what
  would make a youth profile selectable) is a **later phase**; today the profiles are
  simply not self-selectable.
- **Minimal-information posture** — the Kids prompt explicitly avoids requesting personal
  information; a broader youth data-minimization/retention regime is readiness.

BIINA keeps its honesty posture here: selecting or provisioning a youth experience does
**not** by itself constitute a certified child-safety, compliance, or parental-control
guarantee.
