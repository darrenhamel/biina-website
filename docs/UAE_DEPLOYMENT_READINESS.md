# BIINA.ai — UAE Deployment Readiness

A UAE-hosted deployment profile for BIINA — inference, storage, and vector store configured
to the **UAE** region. BIINA is an Abu Dhabi education-AI company, so a UAE-hosted profile
is a natural target; this document describes it **honestly** as a logical configuration, not
a certification. Read with [`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md),
[`PRIVATE_MODELS.md`](./PRIVATE_MODELS.md),
[`SOVEREIGN_DEPLOYMENT.md`](./SOVEREIGN_DEPLOYMENT.md), and the activation steps in
[`UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md`](./UAE_DEPLOYMENT_ACTIVATION_CHECKLIST.md).

## Region metadata, not a compliance claim

`UAE` is one of BIINA's region identifiers (`UAE | EU | US | OTHER`). Tagging a provider or
policy `UAE` means it is **configured as** UAE-hosted — it is **not** evidence of UAE data
residency, sovereignty, or any certification. Real residency is proven by the underlying
infrastructure plus a review, never by the string. This is the same principle stated in
[`DATA_RESIDENCY.md`](./DATA_RESIDENCY.md) and `regions.ts`.

## The UAE profile, logically

A UAE deployment is expressed as:

- A **deployment profile** with `region='UAE'`, `allowedProviderRegions=['UAE']` (and, for
  a private deployment, `privateStorageRequired` / `privateVectorStoreRequired`).
- A **data-residency policy** requiring `UAE` (`requiredRegions`/`modelInferenceRegion`), so
  the router only selects UAE-region providers and throws `NO_COMPLIANT_MODEL_AVAILABLE`
  rather than falling back elsewhere.
- One or more **private providers** (`region='UAE'`) pointing — by env ref — at UAE-hosted
  inference. **No vendor is assumed**: the endpoint may be any OpenAI-compatible / Ollama
  host you approve; BIINA stays vendor-independent and exposes only logical model ids
  (`biina`, `biina-gov`, …).

## No vendor assumption

Nothing here names or requires a particular cloud, GPU vendor, or model provider. The
gateway abstracts the provider; the UAE profile is satisfied by whatever UAE-region
infrastructure you provision and approve. Swapping the underlying host later is a registry
change, not a product change.

## What is ready vs what you provide

- **Ready in code (IMPLEMENTED):** region vocabulary, UAE-region routing + residency
  enforcement, private UAE providers with tenant isolation and env-ref secrets, audit +
  snapshots.
- **You provide (REQUIRES INFRASTRUCTURE):** actual UAE-hosted inference, storage, vector
  store, secret store, and backups in the approved region; the network egress policy.
- **You review (REQUIRES SECURITY/COMPLIANCE REVIEW):** whether the deployment meets any
  specific UAE legal/regulatory requirement. **BIINA does not make legal residency or
  certification claims.**

## Status

- UAE logical profile, region-aware routing, private UAE providers — **IMPLEMENTED /
  ARCHITECTURALLY READY**.
- UAE-hosted infrastructure + backups + egress — **REQUIRES INFRASTRUCTURE**.
- Regulatory/legal conformance — **REQUIRES SECURITY/COMPLIANCE REVIEW** (never claimed by
  metadata).
