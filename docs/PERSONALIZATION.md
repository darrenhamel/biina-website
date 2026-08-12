# BIINA.ai — Personalization

How BIINA.ai adapts *presentation* to a user — response style, tone, language —
using **explicit account settings** that are authoritative but still yield to
the current request. Personalization is deliberately **separate from inferred
memory**: it is something the user chose, not something BIINA guessed. Code:
`apps/web/src/server/memory/personalization.ts` +
`apps/web/src/server/memory/consent.ts`. Companion docs:
[`MEMORY_ARCHITECTURE.md`](./MEMORY_ARCHITECTURE.md), [`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md),
[`MEMORY_PRIVACY.md`](./MEMORY_PRIVACY.md).

## Explicit settings vs. inferred memory

Two things shape how an answer reads, and they are not the same:

| | Explicit personalization | Inferred memory |
|---|---|---|
| **Origin** | the user set it in Settings | BIINA proposed it from a message |
| **Trust** | authoritative (an instruction) | background context (a hint) |
| **Confidence** | certain | `< 1.0`, marked `(inferred)` |
| **Storage** | `profiles` columns | `memories` rows |
| **Applies in temporary chat?** | yes (it's a setting) | no |
| **Applies when memory is off?** | yes | no |

Because personalization is an explicit choice, it carries **higher trust** than a
remembered preference — but it is still a *default*, not a hard rule.

## Authoritative, but overridable by the request

The precedence order ([`CONTEXT_ENGINE.md`](./CONTEXT_ENGINE.md)) places explicit
profile settings **above durable memory** but **below the CURRENT REQUEST**. So:

- A "concise by default" setting shortens answers in general.
- "Give me a detailed walkthrough this time" **overrides** it for that turn.

The instruction text makes this explicit — it tells the model these are "default
presentation preferences (apply them only when they do not conflict with the
current request, which always wins)." Nothing about personalization can touch
platform safety or org policy; it only affects style, tone, and language of the
reply.

## The settings

`personalizationInstruction` turns non-default profile fields into one short
sentence (and emits **nothing** when everything is default, so a default user
gets no extra prompt weight):

- **`responseStyle`** — `default` · `concise` (executive-style) · `detailed`
  (thorough).
- **`tone`** — `default` · `formal` (professional) · `casual` (friendly).
- **`locale`** — the user's language (`en` default). BIINA is bilingual and
  replies in the language the user writes in regardless; the locale is the
  account default.

Memory **consent** settings live next to these on the profile and are read by
`getMemorySettings`:

- **`memoryEnabled`** (default `true`) — the master personal consent switch;
  off ⇒ no retrieval and no new inferred memory ([`MEMORY_PRIVACY.md`](./MEMORY_PRIVACY.md)).
- **`memoryMode`** — `OFF` · `ASK` (default) · `AUTO`, governing inferred memory
  only (explicit "remember" always works).

## The settings surface

Personalization and memory consent are read/written through one endpoint:

- `GET /api/memory/settings` — current `memoryEnabled`, `memoryMode`,
  `responseStyle`, `tone`.
- `PATCH /api/memory/settings` — update any subset (validated: `responseStyle ∈
  {default,concise,detailed}`, `tone ∈ {default,formal,casual}`, `memoryMode ∈
  {OFF,ASK,AUTO}`). A change to consent emits a `memory.consent_changed` audit
  event.

Ownership is always the authenticated user — the browser can never edit another
user's settings.

## Organization personalization defaults

Organizations can carry their own style/context via **organization memory**
(`ORGANIZATION_CONTEXT` type, manager-managed — see
[`ORGANIZATION_MEMORY.md`](./ORGANIZATION_MEMORY.md)). Org defaults are still just
context: they **cannot override a user's own safety or platform policy**, and
they only appear inside that org's workspace. A per-user explicit setting and an
org default both feed presentation; neither is authority over the current
request, and org context never leaks into a personal (non-org) chat.
