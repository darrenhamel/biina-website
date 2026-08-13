# BIINA.ai — Load Testing Plan

A **plan** for load-testing the product app. This document describes *what and how
to test*; it does **not** report results.

> **Not executed in this repo.** Real load runs **REQUIRE A STAGING ENVIRONMENT**
> (its own DB, storage, and a **mock AI provider**). None is provisioned here.
> Concurrency numbers below are **staging-capacity examples**, not scalability
> promises.

Owner: `<perf-owner>` · Target: `<staging-host>`

---

## Golden rules
1. **Test staging, never production**, and **never live third-party providers.**
2. **Use the mock AI provider** for AI load — `AI_DEFAULT_PROVIDER=mock` (dev
   feature; only via `ALLOW_DEV_FEATURES_IN_PROD` on a non-prod env). Never drive
   real load at OpenAI/Anthropic/Ollama/vLLM/search/connector providers — it costs
   money and can get you rate-limited or banned.
3. **Isolate billing** — Stripe test mode only; do not fire real webhooks in bulk.
4. Seed staging with `db:seed:production` + synthetic test users you own.

---

## Tooling
- **k6** (recommended) or **autocannon** for HTTP throughput/latency.
  - k6: scripted scenarios, thresholds, ramping VUs, good percentile output.
  - autocannon: quick single-endpoint throughput checks.
- Streaming endpoints (chat) need a client that holds the connection and measures
  **time-to-first-byte/token** — k6 with streaming or a small custom harness.
- Capture server-side: CPU, memory, DB connections/pool saturation, GC, event-loop
  lag (`OBSERVABILITY.md`).

---

## Scenarios

| # | Scenario | Path | Notes |
|---|---|---|---|
| 1 | Homepage / marketing | `GET /{locale}` | Static-ish; baseline edge/app throughput |
| 2 | Login / auth | `POST` auth endpoints | Session creation cost; bcrypt is intentionally slow — expect low RPS per core |
| 3 | Chat (non-stream) | `POST /api/ai/chat` (mock provider) | Core path; measure end-to-end |
| 4 | Chat (streaming) | `POST /api/ai/chat` streaming (mock) | Measure **TTFT** + sustained stream; connection concurrency |
| 5 | Conversation history | history list/read endpoints | DB read-heavy; pagination |
| 6 | File upload | upload endpoint | Storage write (local today — I/O bound); size limits |
| 7 | RAG query | retrieval over `PortableVectorStore` | jsonb + cosine cost as corpus grows |
| 8 | Web/search-grounded | search-backed path | **Mock the search provider** — never hit the real one under load |
| 9 | Admin dashboards | admin usage/readiness | Admin-only; aggregation query cost |

Rate limiting is **per-process in-memory** today — a load test from one client may
hit the limiter; account for it, and note that **multi-instance load needs a
shared rate limiter** (REQUIRES INFRA) before results generalize.

---

## Baseline metrics to capture (every run)
- Requests/sec (throughput) sustained.
- Latency **p50 / p95 / p99** (and TTFT for streaming).
- Error rate (%) and status-code breakdown (esp. 429/503).
- CPU % and memory (RSS) per instance.
- DB: active connections, pool wait time, slow queries.
- Event-loop lag; GC pauses.
- Budget/cost counters stay flat (mock provider = no real spend).

Record baseline first; every later run compares against it.

---

## Concurrency bands (staging-capacity examples — NOT promises)
Run each scenario at increasing virtual users; treat as **capacity discovery** on
`<staging-instance-size>`:

| Band | Concurrent users | Goal |
|---|---|---|
| Light | ~10 | Establish clean baseline, no errors |
| Moderate | ~50 | Find first latency inflection |
| Heavy | ~100 | Find saturation / first sustained 429/503 |

These are illustrative for a single staging instance. Real capacity depends on
instance size, DB tier, and whether a shared cache/rate-limiter exists — do not
quote them as product limits.

---

## Soak test
- Run scenario 3/4 (mock AI) at **moderate** load for **`<2–8 h>`**.
- Watch for: memory growth (leaks), DB connection creep, event-loop lag drift,
  the in-memory rate-limiter/state growing unbounded, error-rate climb over time.
- Pass criteria: flat memory/latency, no connection leak, error rate stable.

---

## Exit checklist
- [ ] Ran against **staging**, mock AI + mock search, Stripe test mode.
- [ ] Baseline + each band captured with p50/p95/p99 + error rate.
- [ ] Saturation point identified; bottleneck named (CPU / DB / rate-limit / I/O).
- [ ] Soak test clean.
- [ ] Findings feed capacity planning + `DISASTER_RECOVERY.md` RTO assumptions.
- [ ] Explicitly note: results are staging-scoped, not a production SLA.
