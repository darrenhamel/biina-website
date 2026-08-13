# BIINA.ai — Post-Launch Backlog

Non-launch-critical work, bucketed by horizon. These items are **deliberately deferred** —
they are not required to open a controlled invite-only beta safely, and are tracked here so
they do not clutter the launch-blocking view in [`LAUNCH_BACKLOG.md`](./LAUNCH_BACKLOG.md).

Pair with the operational [`POST_LAUNCH_PLAN.md`](./POST_LAUNCH_PLAN.md) (24h/7d/30d watch)
and the Scale triggers in
[`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md).

> Grounded rule: an item lands here only if it is **safe to launch without it** — either it is
> held OFF by a flag, or it is a scale/quality/optimization concern that does not affect a
> low-volume beta. Anything that blocks a safe launch stays in the launch backlog.

---

## v1.0.1 — fast follow (first weeks)

- **`drizzle-orm` dependency bump** (LB-18) — routine maintenance; re-run ~291 tests + build.
- **Replace `<placeholders>`** in the cost model with real provider numbers after the first
  week of real AI spend ([`INFRASTRUCTURE_COST_MODEL.md`](./INFRASTRUCTURE_COST_MODEL.md)).
- **Promote validated BETA features** only on evidence: web grounding (once a vendor key is in
  and per-query cost is understood), curated library reach.
- **Tune per-plan quotas / budgets** against observed real usage.

## v1.1 — reliability & scale readiness

- **Distributed rate limiting** (LB-06) — move process-local limiter to a shared store
  (e.g. Redis) before running more than one app instance.
- **Out-of-process worker/scheduler** (LB-13) — separate the workflow tick worker from the app
  when queue backlog / tick lag appears.
- **Real embedding endpoint at quality** (LB-04) if RAG launched on the dev embedder — re-embed
  to rebuild the vector store.
- **Load testing at scale** — validate the provisional Scale triggers against real numbers
  ([`LOAD_TESTING.md`](./LOAD_TESTING.md)).
- **DB pooler / read replicas** — when connection utilization sustains high.

## v1.2 — feature depth

- **Real multimodal providers** (LB-05) — validate vision/OCR, then STT/TTS, before enabling
  ([`MULTIMODAL_ACTIVATION_CHECKLIST.md`](./MULTIMODAL_ACTIVATION_CHECKLIST.md)).
- **Voice mode** — enable only after real STT/TTS + latency validation
  ([`VOICE_MODE.md`](./VOICE_MODE.md)).
- **Real connectors GA** — live OAuth for read-only connectors, then a validated approval flow
  for external writes ([`CONNECTOR_ACTIVATION_CHECKLIST.md`](./CONNECTOR_ACTIVATION_CHECKLIST.md)).
- **Memory inference / auto-save** — consider promoting from ASK-only once consent UX + privacy
  are validated ([`MEMORY_PRIVACY.md`](./MEMORY_PRIVACY.md)).

## Enterprise

- **SAML SSO** (LB-15) — real cryptographic verifier + org config (default verifier fails
  closed in prod) ([`SAML.md`](./SAML.md)).
- **SCIM provisioning** — org config ([`SCIM.md`](./SCIM.md)).
- **Dedicated / private providers GA** — per-org provisioning at scale
  ([`PRIVATE_MODELS.md`](./PRIVATE_MODELS.md)).
- **Enterprise onboarding** hardening ([`ENTERPRISE_ONBOARDING_CHECKLIST.md`](./ENTERPRISE_ONBOARDING_CHECKLIST.md)).

## Government / Sovereign

- **UAE / sovereign deployment** (LB-15) — in-region hosting/DB/storage/inference + secrets +
  backups, plus **security and legal/compliance reviews**. Region tags are not a compliance
  claim ([`UAE_DEPLOYMENT_REVIEW.md`](./UAE_DEPLOYMENT_REVIEW.md),
  [`SOVEREIGN_DEPLOYMENT.md`](./SOVEREIGN_DEPLOYMENT.md)).

## Optimization

- **`pgvector` migration** (LB-12) — move PortableVectorStore → `pgvector` when RAG/memory
  retrieval latency dominates ([`VECTOR_STORAGE.md`](./VECTOR_STORAGE.md)).
- **Per-unit AI cost service** — a precise cost-attribution service beyond the current metered
  estimates ([`COST_CONTROLS.md`](./COST_CONTROLS.md)).
- **Distributed tracing** (OpenTelemetry across web → DB → gateway → provider) —
  ([`OBSERVABILITY.md`](./OBSERVABILITY.md)).
- **Object-storage lifecycle tiering / CDN edge caching** — as storage + traffic grow.
- **Multi-region / DR maturity** — cross-region replication + DNS failover
  ([`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md)).

---

## Standing post-launch obligations (from the launch backlog, scheduled not deferred)

These are **required**, just executed after opening the beta — do not lose them:

- **External penetration test / security review** (LB-16) — schedule/scope in the first days;
  complete before widening the cohort or going paid/public.
- **Verified restore drill** (LB-09) — if not done pre-launch, do it in the first 30 days with
  real data.
- **Live billing legal review** (LB-10/LB-17) — before any paid tier.

See [`POST_LAUNCH_PLAN.md`](./POST_LAUNCH_PLAN.md) for the time-boxed watch list.
