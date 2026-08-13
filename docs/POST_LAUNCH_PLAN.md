# BIINA.ai — Post-Launch Plan (Phase 18)

What to watch and do **after** the invite-only beta opens. Three horizons: first **24 hours**,
first **7 days**, first **30 days**. Each item is a checkbox; owners fill in as they go.

Companions: [`LAUNCH_DAY_RUNBOOK.md`](./LAUNCH_DAY_RUNBOOK.md),
[`OBSERVABILITY.md`](./OBSERVABILITY.md),
[`INFRASTRUCTURE_COST_MODEL.md`](./INFRASTRUCTURE_COST_MODEL.md),
[`PRODUCTION_INFRASTRUCTURE_CHECKLIST.md`](./PRODUCTION_INFRASTRUCTURE_CHECKLIST.md) (Scale
triggers), [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md).

---

## First 24 hours — stabilize

### Bugs / errors
- ☐ Watch error rate + new exception types; triage anything user-facing immediately.
- ☐ Confirm auth, chat streaming, file upload/RAG, and email delivery all healthy under real
  users.
- ☐ Keep a running incident/anomaly log.

### Cost
- ☐ Check AI token spend against the cost alarm at least a few times; confirm no runaway
  usage (dominant variable cost).
- ☐ Confirm per-plan quotas + hard-budget checks are actually bounding heavy users.

### Security
- ☐ Confirm no secrets in logs; confirm kill switches + maintenance mode reachable.
- ☐ Watch for abuse signals (signup floods, suspicious tool/connector attempts).

### Feedback / performance
- ☐ Read early feedback; capture themes.
- ☐ Watch latency/TTFT, DB connection utilization, and queue/tick lag; note any Scale-trigger
  approach.

### Feature adoption
- ☐ Note which v1 features are actually used vs ignored; confirm high-risk features remain
  OFF/behind flags.

---

## First 7 days — tune

### Bugs / errors
- ☐ Fix the top user-facing bugs; ship low-risk patches.
- ☐ Review recurring errors for systemic causes.

### Cost
- ☐ Review a full week of AI spend by model; decide whether model choice/context size needs
  tuning to control the dominant cost line.
- ☐ Reconcile actual spend against [`INFRASTRUCTURE_COST_MODEL.md`](./INFRASTRUCTURE_COST_MODEL.md)
  assumptions; replace `<placeholders>` with real numbers.

### Security
- ☐ **Schedule/scope the external penetration test / security review** (still outstanding).
- ☐ Re-check tenant isolation and rate limiting under real multi-user load.

### Feedback / performance
- ☐ Consolidate feedback into a prioritized list.
- ☐ Load-test the paths showing pressure per [`LOAD_TESTING.md`](./LOAD_TESTING.md); validate
  provisional Scale triggers against real numbers.

### Feature adoption
- ☐ Decide which behind-a-flag features are candidates to promote after validation (e.g. voice,
  broader connectors) — none promoted without evidence.

---

## First 30 days — decide & harden

### Bugs / errors
- ☐ Burn down the backlog; confirm error rate is stable and low.

### Cost
- ☐ Establish a steady-state monthly cost picture; set budgets/alarms accordingly.
- ☐ Right-size compute/DB based on observed utilization (up or down).

### Security
- ☐ Complete (or have in progress) the **external security review**; remediate findings.
- ☐ Confirm at least one **successful restore drill** post-launch (backups tested with real
  data). See [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md).

### Feedback / performance
- ☐ Turn feedback themes into a roadmap for the next phase.
- ☐ Address any Scale trigger that fired (worker out-of-process, `pgvector`, shared
  rate-limit store, DB pooler).

### Feature adoption
- ☐ Review adoption + reliability data; decide go/no-go on:
  - promoting flagged features (voice, wider connectors) from BETA → ON,
  - enabling live billing (if not already, and only after legal review),
  - widening the beta cohort or moving toward GA.
- ☐ Re-evaluate whether the deployment is ready to leave **invite-only beta** — GA is a
  deliberate decision, not a default.
