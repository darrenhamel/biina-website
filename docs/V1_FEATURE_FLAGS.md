# BIINA.ai — V1 Launch Feature Matrix

The launch-time state for every feature, its readiness reason, the configuration it needs,
and the **exact env flag** that kills or rolls it back. This is the operational companion to
[`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) (which explains the rationale) — here each row is
grounded in the current flag defaults and readiness from [`LAUNCH_BACKLOG.md`](./LAUNCH_BACKLOG.md).

> A flag is a **hard platform control**. Nothing a persona, library item, or source content
> says can widen it. Flags gate availability; they never replace server-side authorization,
> quotas, or approvals.

Launch-state legend: **ON AT LAUNCH** · **BETA** (limited/watched) · **ADMIN ONLY** ·
**INVITE-ONLY** · **OFF**.

---

## Recommended conservative v1 (invite-only beta)

| Feature | Launch state | Reason | Required configuration | Rollback / kill switch (env flag) |
|---|---|---|---|---|
| Authentication (signup, login, sessions) | **ON AT LAUNCH** | Core; hardened + audited (bcrypt-12, hashed single-use tokens, CSRF/HSTS). | `AUTH_SECRET` (≥32 chars); **email adapter for verification/reset (LB-02)**. | Core — not flagged; `/api/health` + maintenance controls. |
| Chat (streaming, stop, regenerate) | **ON AT LAUNCH** | Mature; the product's core. | Real `AI_DEFAULT_PROVIDER` (not `mock`) + `AI_DEFAULT_MODEL`. | AI maintenance mode (DB toggle); provider `maintenanceMode`. |
| Conversation history | **ON AT LAUNCH** | Mature; DB-backed. | Managed Postgres. | Core — not flagged. |
| AI gateway / model routing | **ON AT LAUNCH** | Provider-independent, DB control plane, tested. | Model registry + `AI_DEFAULT_PROVIDER`/`AI_DEFAULT_MODEL`. | AI maintenance mode; per-provider `maintenanceMode`. |
| Primary model + fast model | **ON AT LAUNCH** | Two-tier routing is the intended v1 shape. | Register one primary + one fast model on the real provider. | Disable a model in the registry; AI maintenance mode. |
| Usage metering | **ON AT LAUNCH** | Implemented; admin usage/cost view. | Managed Postgres. | Core — not flagged. |
| Cost controls (per-plan quotas + hard budget) | **ON AT LAUNCH** | Implemented (Phase 5); bounds the dominant variable cost. | Plan entitlements seeded (`npm run db:seed:production`). | Budget hard-limit refuses AI at threshold. |
| Files / Knowledge bases / RAG / citations | **ON only if durable storage + real embeddings configured; else BETA/OFF** | Tenant-isolated retrieval is ready, but local FS is not durable (LB-03) and the dev embedder is low quality (LB-04). | `FILE_STORAGE_PROVIDER=s3\|r2` + real `EMBEDDING_PROVIDER`. | `RAG_ENABLED=false`. |
| Basic memory / personalization | **ON (BETA, conservative)** | Consent-gated; inference/auto-save off keeps it from ever acting as authority. | Profile consent (ASK). | `MEMORY_ENABLED=false`; `MEMORY_INFERENCE_ENABLED`/`MEMORY_AUTO_SAVE_ENABLED` stay `false`. |
| Admin control plane | **ADMIN ONLY** | Guarded admin routes; needed for kill switches + maintenance. | First admin via [`FIRST_ADMIN_BOOTSTRAP.md`](./FIRST_ADMIN_BOOTSTRAP.md). | Role-gated; SUPER_ADMIN only. |
| Arabic / English + full RTL | **ON AT LAUNCH** | Bilingual/RTL from the start; core requirement. | None. | Core — not flagged. |
| Experience profiles (personas) | **ON AT LAUNCH** | Preference only, never a permission. | None. | `EXPERIENCE_PROFILES_ENABLED=false`. |
| Curated / private library + installs | **BETA** | Installing grants no permission; safe but watch. | Seeded curated items (post-bootstrap). | `LIBRARY_ENABLED=false`; `LIBRARY_INSTALLATION_ENABLED=false`. |

## Watched / limited at launch

| Feature | Launch state | Reason | Required configuration | Rollback / kill switch (env flag) |
|---|---|---|---|---|
| Web search / grounding | **BETA if a live vendor key is set; else OFF** | Pipeline solid but provider is mock (LB-11); per-query cost. | `WEB_SEARCH_PROVIDER` + vendor key. | `WEB_SEARCH_ENABLED=false`. |
| Vision / OCR | **BETA (mock) → OFF until a real provider is validated** | Providers are mock (LB-05); do not present as real. | Real `VISION_PROVIDER`/`OCR_PROVIDER`. | `MULTIMODAL_ENABLED=false`. |
| Personal connectors (Google/Slack, read-only) | **BETA / OFF** | Read-only path is safe but needs live OAuth creds; writes disabled. | OAuth creds; `CONNECTOR_WRITE_ACTIONS_ENABLED=false`. | `CONNECTOR_WRITE_ACTIONS_ENABLED=false` (writes); disable connector. |
| Read-only agents | **BETA** | Bounded, read-only; external writes off. | Agent execution on; write actions off. | `AGENT_WRITE_ACTIONS_ENABLED=false`; `AGENT_EXECUTION_ENABLED=false` to stop. |
| Manual workflows (read-only) | **BETA / ADMIN ONLY** | Read-only runs are fine while the worker is in-process (LB-13). | `WORKFLOW_TICK_SECRET` + external tick. | `WORKFLOWS_ENABLED=false`; `WORKFLOW_SCHEDULER_ENABLED=false`. |
| Advanced research (read-only multi-agent) | **INVITE-ONLY / BETA** | Enabled in code but bounded; validate real load + cost first. | Quotas; embedding/search readiness. | `ADVANCED_RESEARCH_ENABLED=false`; `MULTI_AGENT_RESEARCH_ENABLED=false`. |
| Dedicated / private providers | **ADMIN ONLY** | Available but only meaningful once an org provisions one. | Per-org provider config. | `DEDICATED_PROVIDER_SUPPORT_ENABLED=false`. |
| Enterprise surfaces master gate | **ADMIN ONLY** | Surfaces gated per org; sub-features stay OFF. | Org config. | `ENTERPRISE_FEATURES_ENABLED=false`. |

## Off at launch

| Feature | Launch state | Reason | Required configuration | Rollback / kill switch (env flag) |
|---|---|---|---|---|
| Voice mode / TTS / STT | **OFF** | Providers mock (LB-05); validate real providers + latency first. | Real STT/TTS providers. | `VOICE_MODE_ENABLED=false`. |
| Agent **external writes** | **OFF** | Ships on mock adapters; real writes need live scopes + validated approval flow (LB-14). | Live scopes + activation. | `AGENT_WRITE_ACTIONS_ENABLED=false`. |
| **Scheduled** external writes | **OFF** | Unattended write path; highest risk. | Standing auth + write switch. | `WORKFLOW_SCHEDULED_WRITES_ENABLED=false`. |
| Open / public marketplace | **OFF** | Public marketplace + payouts not open (LB-14). | — | `PUBLIC_LIBRARY_ENABLED=false`; `PUBLIC_CREATOR_PUBLISHING_ENABLED=false`; `PAID_MARKETPLACE_ENABLED=false`. |
| SAML SSO | **OFF** | Needs org config + a real cryptographic verifier; default verifier fails closed in prod (LB-15). | Real SSO verifier. | `SAML_ENABLED=false`. |
| SCIM provisioning | **OFF** | Enterprise-only; needs org config. | — | `SCIM_ENABLED=false`. |
| Sovereign mode | **OFF** | Needs in-region infra + security/legal reviews (LB-15). | See [`UAE_DEPLOYMENT_REVIEW.md`](./UAE_DEPLOYMENT_REVIEW.md). | `SOVEREIGN_MODE_ENABLED=false`. |
| Live billing / paid plans | **OFF** | Stripe TEST mode; enable only after approval + legal review (LB-10). | See [`LIVE_BILLING_ACTIVATION.md`](./LIVE_BILLING_ACTIVATION.md). | `BILLING_LIVE_MODE=false`. |

## Operational controls (not user features)

| Control | Launch state | Reason | Flag / mechanism |
|---|---|---|---|
| AI maintenance mode | Available (admin) | Fast global stop for AI. | DB-backed toggle. |
| CSP + security headers | **Enforced** | Never disable in production. | `CSP_DISABLED` unset/false. |
| Dev features in prod | **OFF** | Must never be true in production; mock/dev seed refused. | `ALLOW_DEV_FEATURES_IN_PROD=false`. |

---

## One-line v1 scope

**ON:** auth, chat + history, gateway/routing, primary+fast model, metering, cost controls,
personas, Arabic/English/RTL. **ON if durable storage + real embeddings:** Files/KB/RAG/citations
(else BETA/OFF). **BETA (watch):** basic memory, curated library, web grounding (with key),
vision, read-only connectors/agents, manual workflows, advanced research. **OFF:** voice, agent
+ scheduled external writes, public marketplace, SAML/SCIM/sovereign, live billing. Every state
maps to a real flag above; run `npm run validate:production` to confirm nothing risky is ON by
accident.
