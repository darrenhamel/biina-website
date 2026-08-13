# BIINA.ai — Infrastructure Cost Model (Phase 18)

A **rough monthly cost model** by category. This is a *structure for reasoning about spend*,
not a quote.

> **No invented prices.** This document deliberately contains **no real provider prices**.
> Every figure depends on the providers you choose and your usage; get live quotes before
> committing. Where a number is unavoidable it is a `<placeholder>`.

Cost-type legend:
- **FIXED ESTIMATED** — roughly constant month to month once provisioned.
- **USAGE-VARIABLE** — scales with traffic/usage; hard to bound without real numbers.
- **UNKNOWN — NEEDS QUOTE** — depends entirely on provider selection.

---

## Cost by category

### Application compute
- **Type:** FIXED ESTIMATED (baseline) + USAGE-VARIABLE (autoscale).
- **Drivers:** number/size of app instances, whether the worker runs in-process (beta) or on
  its own hosts (scale), autoscaling headroom, egress.
- **Determined by:** concurrent request volume and streaming duration. A beta on one small
  instance is near-fixed; a scaled fleet becomes usage-variable.

### Database
- **Type:** FIXED ESTIMATED.
- **Drivers:** managed Postgres instance size (vCPU/RAM), storage volume, IOPS, replicas,
  HA/standby.
- **Determined by:** connection concurrency and data volume. Note the shipped
  PortableVectorStore and RAG/memory data live in this same Postgres for beta, so DB size is
  driven partly by embeddings until `pgvector`/a vector DB is split out.

### Object storage
- **Type:** USAGE-VARIABLE.
- **Drivers:** total bytes stored, request counts (PUT/GET), egress bandwidth for downloads.
- **Determined by:** how many files/media users upload and how often they are retrieved.
  Grows monotonically unless lifecycle-archived.

### AI inference
- **Type:** USAGE-VARIABLE — **the dominant variable cost.**
- **Drivers:** `tokens × model rate` (or GPU-hours for self-hosted endpoints), request
  volume, average context size (RAG/web/memory inflate input tokens), streaming length,
  concurrency, and whether the endpoint is always-on or scales to zero.
- **Determined by:** active users × messages × tokens-per-message × model tier. **This is the
  line item most likely to surprise you** — meter it from day one and set cost alarms.
  Per-plan quotas + hard-budget checks (Phase 5) exist to bound it. See [`COST_CONTROLS.md`](./COST_CONTROLS.md).

### Search (web grounding + vector search)
- **Type:** USAGE-VARIABLE.
- **Drivers:** external web-search provider calls (per-query pricing), and — separately — the
  compute cost of vector search (currently in-DB; a dedicated vector service if split out).
- **Determined by:** how many chats opt into web grounding and corpus size for RAG/memory.
  The shipped search provider is deterministic-offline (no cost); a live vendor key adds
  per-query cost.

### Email
- **Type:** USAGE-VARIABLE (often with a FIXED ESTIMATED floor).
- **Drivers:** transactional email volume (verification, reset, invitations, notifications),
  sometimes a fixed monthly plan tier.
- **Determined by:** signup rate and notification frequency. Low for a small beta.

### Monitoring / observability
- **Type:** FIXED ESTIMATED (plan tier) + USAGE-VARIABLE (data ingested).
- **Drivers:** metric/log/trace ingestion volume, retention window, number of monitors/alerts,
  seats.
- **Determined by:** how verbose logging is and how long you retain it. Log volume scales with
  traffic.

### Backups
- **Type:** USAGE-VARIABLE (small relative to the rest).
- **Drivers:** backup storage volume, retention length, off-region replication egress, restore
  testing.
- **Determined by:** database + object-storage size and how many restore points you keep.

---

## Minimum-viable-production vs scaled (qualitative)

| Category | Invite-only beta | Scaled |
|---|---|---|
| App compute | One small instance; worker + scheduler in-process | Multiple app instances + separate worker fleet; autoscale |
| Database | One managed instance; PortableVectorStore in-DB | Larger instance + pooler + read replicas; vector split to `pgvector`/vector DB |
| Object storage | Small S3/R2 bucket | Larger bucket + lifecycle tiering + CDN in front |
| AI inference | One endpoint, modest concurrency; **still the biggest variable** | Scaled/replicated endpoints; concurrency-tuned; dominant spend |
| Search | Offline mock (free) or light live usage | Live provider at query volume; possible dedicated vector search |
| Email | Free/low tier | Higher tier at signup + notification volume |
| Monitoring | Basic uptime + errors + one cost alarm | Full metrics/logs/traces with retention |
| Backups | Automated + one tested restore | PITR + off-region + regular restore drills |
| CDN / WAF | WAF recommended; CDN optional | CDN edge caching + tuned WAF |

**Rules of thumb (unpriced):**
- The **biggest lever on total cost is AI inference** — controlled by model choice, context
  size, and per-plan quotas, not infrastructure.
- Beta cost is **mostly fixed** (a couple of small always-on resources). Scaled cost becomes
  **mostly usage-variable**, led by inference.
- Cross-check the provisioning list in
  [`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md); price
  each `REQUIRES INFRASTRUCTURE` item with a real quote before launch.

> Fill a `<placeholder>` only from an actual provider quote. Do not present modeled numbers as
> real prices.
