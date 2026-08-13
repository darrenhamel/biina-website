# BIINA.ai — Feature Flags & v1 Launch Scope (Phase 18)

Every major feature, its controlling flag, and the **recommended conservative scope** for a
**controlled, invite-only beta (v1)**. Recommendations follow the honest readiness of each
area — mature, well-tested paths are ON; anything with real-world write side effects, live
external cost, unvalidated providers, or an unopened marketplace stays **behind a flag / OFF**
until validated.

> A flag is a **hard platform control**. Nothing a persona, a library item, or source content
> says can widen it. Flags **gate availability**; they never replace server-side
> authorization, quotas, or approvals.

Recommendation legend:
- **ON AT LAUNCH** — enabled for beta users.
- **BETA** — available but limited/behind a plan/quota, watch closely.
- **ADMIN ONLY** — reachable by admins, not general users.
- **OFF** — disabled at launch; enable later only after validation (and, where relevant,
  approval + legal/security review).

Env defaults referenced below are the current `.env.example` values. See
[`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md) and
[`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md).

---

## Core experience

| Feature | Controlling flag / gate | v1 recommendation | Why |
|---|---|---|---|
| Chat (streaming, stop, regenerate) | Core — always on; `AI_DEFAULT_PROVIDER` must be real (not `mock`) | **ON AT LAUNCH** | Mature; the product's core. |
| Core models / routing | Model registry + `AI_DEFAULT_PROVIDER`/`AI_DEFAULT_MODEL`; DB control plane | **ON AT LAUNCH** | Provider-independent, tested. |
| Files / Knowledge bases / RAG | `RAG_ENABLED=true` + per-plan entitlements | **ON AT LAUNCH** | Tenant-isolated retrieval; PortableVectorStore rebuildable. |
| Web search / grounding | User opt-in + plan quota; live vendor key needed for real results | **BETA** | Pipeline solid; real vendor key + per-query cost to confirm. Offline mock otherwise. |
| Basic memory / personalization | Profile consent (ASK/AUTO/off); not an env flag | **BETA** | Consent-gated; start conservative (ASK), never authority. |
| Vision | Multimodal service; real provider needs activation | **BETA** | Pipeline ready; validate the real vision provider first. |
| Personal connectors (Google/Slack, **read-only**) | OAuth + connector flags; write tools disabled | **BETA** | Read-only path is safe; needs live OAuth creds; watch quotas. |
| Advanced research (read-only multi-agent) | `plan.agentEnabled` + research quotas; source provider offline in dev | **BETA** | Read-only, bounded; validate under real load + cost. |

## Requires validation — keep flagged / OFF at launch

| Feature | Controlling flag | v1 recommendation | Why |
|---|---|---|---|
| Agent **external writes** (Gmail/Calendar/Slack) | `AGENT_WRITE_ACTIONS_ENABLED=false` | **OFF** | Ships on mock adapter; real writes need live scopes + manual activation + approval flow validated. |
| **Scheduled** external writes | `WORKFLOW_SCHEDULED_WRITES_ENABLED=false` (+ standing auth + write switch) | **OFF** | Unattended write path; highest risk. Off by default by design. |
| Workflows / scheduled automations (read-only) | Workflow engine + `WORKFLOW_TICK_SECRET`; in-process worker | **BETA / ADMIN ONLY** | Read-only runs are fine; keep narrow while worker is in-process. |
| High-risk / destructive or financial agent actions | Risk taxonomy — denied by default | **OFF** | Denied by default in code; do not enable for beta. |
| Open / public marketplace | `PUBLIC_LIBRARY_ENABLED=false`, `PUBLIC_CREATOR_PUBLISHING_ENABLED=false`, `PAID_MARKETPLACE_ENABLED=false` | **OFF** | Public marketplace + payouts not open. Curated/private library can stay on. |
| Curated / private library + installs | `LIBRARY_ENABLED=true`, `LIBRARY_INSTALLATION_ENABLED=true` | **BETA** | Installing grants no permission; safe but watch. |
| Voice mode / TTS / STT | Multimodal voice; real providers need activation | **OFF** (until validated) | Turn-based, never bypasses approval; validate real providers + latency first. |
| SAML SSO | `SAML_ENABLED=false` | **OFF** | Needs org config + a real verifier; enterprise-only. |
| SCIM provisioning | `SCIM_ENABLED=false` | **OFF** | Needs org config; enterprise-only. |
| Sovereign mode | `SOVEREIGN_MODE_ENABLED=false` | **OFF** | Needs in-region infra + reviews (see [`UAE_DEPLOYMENT_REVIEW.md`](./UAE_DEPLOYMENT_REVIEW.md)). |
| Dedicated / private providers | `DEDICATED_PROVIDER_SUPPORT_ENABLED=true` (gated per org) | **ADMIN ONLY** | Available but only meaningful once an org provisions one. |
| Live billing / paid plans | Two billing safety flags; Stripe **TEST** mode today | **OFF** | Enable only after approval + subscription/refund legal review + [`PRODUCTION_BILLING_CHECKLIST.md`](./PRODUCTION_BILLING_CHECKLIST.md). |
| Experience profiles (personas) | `EXPERIENCE_PROFILES_ENABLED=true` | **ON AT LAUNCH** | Preference only, not a permission; safe. |
| Enterprise surfaces master gate | `ENTERPRISE_FEATURES_ENABLED=true` | **ADMIN ONLY** | Surfaces gated per org; individual sub-features (SAML/SCIM) stay OFF. |

## Operational controls (not user features)

| Control | Flag / mechanism | v1 recommendation | Why |
|---|---|---|---|
| AI maintenance mode | DB-backed toggle | Available (admin) | Fast global stop for AI. |
| Kill switches | Agent writes, research, library/marketplace, enterprise (SAML/SCIM/sovereign) | Available (admin) | Must be reachable on launch day. |
| CSP | `CSP_DISABLED` unset/false | **Enforced** | Never disable in production. |
| Dev features in prod | `ALLOW_DEV_FEATURES_IN_PROD=false` | **OFF** | Must never be true in production. |

---

## Recommended v1 scope, in one line

**ON:** Chat, core models/routing, Files/RAG, personas. **BETA (watch):** web grounding, basic
memory, vision, personal read-only connectors, read-only research, curated/private library.
**OFF until validated / approved:** scheduled + agent external writes, high-risk agents, open
marketplace, voice, SAML/SCIM, sovereign mode, and live billing.

This scope reflects real readiness: enable what is mature and side-effect-free first; hold back
anything that writes to the outside world, spends live money, relies on an unvalidated provider,
or opens a marketplace — until it is validated in the beta and, where relevant, cleared by the
required approval or review.
