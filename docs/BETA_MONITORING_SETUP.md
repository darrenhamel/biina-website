# BIINA.ai — Beta Monitoring Setup (5–20 users)

The **minimum** monitoring that makes a 5–20 user invite-only beta safe to run, and no more.
A beta this size does **not** need enterprise APM, distributed tracing, or a full SRE stack.
It needs four things that are cheap to stand up and that catch the failures that actually
matter: the app being down, errors spiking, latency degrading, and AI spend running away.

This is the proportionate subset of [`OBSERVABILITY.md`](./OBSERVABILITY.md) (the full
metrics/alerts/dashboards reference). When a [scale trigger](./MINIMUM_PRODUCTION_TOPOLOGY.md#scale-triggers)
fires, graduate to that doc.

Related: [`OBSERVABILITY.md`](./OBSERVABILITY.md) ·
[`HETZNER_DEPLOYMENT.md`](./HETZNER_DEPLOYMENT.md) ·
[`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md) ·
[`COST_CONTROL_RUNBOOK.md`](./COST_CONTROL_RUNBOOK.md) ·
[`HUMAN_LAUNCH_ACTIONS.md`](./HUMAN_LAUNCH_ACTIONS.md)

> **HUMAN ACTION throughout:** picking and paying for an uptime/alerting service, and
> **setting alert destinations** (email/SMS/Slack/PagerDuty), are human/business steps.
> Automation must not create those accounts or accept their terms. Destinations below are
> written as `<placeholder>` on purpose.

---

## The four things you must have

| # | Signal | Minimum for beta | "Good enough" looks like | Source in the app today |
|---|---|---|---|---|
| 1 | **Uptime** | External check on `GET /api/health` every 1–5 min from off-box | 2 consecutive fails → alert; recovery notification too | `/api/health` → `200 {"status":"ok"}` / `503 degraded` (**IMPLEMENTED**) |
| 2 | **Error rate + latency** | 5xx/503 rate and p95 latency at the edge | Alert on 5xx spike or p95 regression over a short window | Cloudflare edge analytics + structured app logs (**REQUIRES INFRA to aggregate**) |
| 3 | **AI cost alarm** | A threshold on the dominant variable cost | Daily/monthly spend vs a budget, alert at warning + hard | Admin → Usage & Cost; `evaluateBudget` status (**IMPLEMENTED**) |
| 4 | **Log sink w/ redaction** | Somewhere to read secret-redacted logs after the fact | Central sink with retention; on-box rotation as the floor | JSON stdout, `REDACT_KEYS` on (**IMPLEMENTED**); shipping = **REQUIRES INFRA** |

Everything below is detail on these four. If you only do these four, the beta is monitored.

---

## 1. External uptime check on `/api/health` — detect → act → verify

`/api/health` returns `200 {status:"ok"}` only when app **and** DB **and** config are
healthy, `503 degraded` otherwise, and it **never leaks which config var failed** (that
detail is admin-only at `/api/admin/production-readiness`). That makes it a safe public
probe.

**Act**

1. **HUMAN ACTION** — Create an account on an external uptime service (e.g. a hosted uptime
   monitor, or Cloudflare Health Checks / a Worker Cron probe since Cloudflare already
   fronts the box). It must probe from **off the box** so it also catches the box being
   unreachable.
2. Point it at `https://app.biina.ai/api/health`, interval **1–5 min**, expect HTTP `200`
   and body containing `"status":"ok"`.
3. **HUMAN ACTION** — Set the alert destination(s): `<on-call-email>` / `<sms-or-slack>`.
   Alert after **2 consecutive** failures (avoids single-blip noise); notify on recovery.

**Verify** — trigger a test (e.g. temporarily stop the `web` container in staging, or use
the provider's "test alert") and confirm the alert reaches the destination, then recovers.

> Map severity per [`OBSERVABILITY.md` alerts](./OBSERVABILITY.md#alerts--severities):
> health `503` sustained > ~5 min is **CRITICAL**.

---

## 2. Error rate + latency

You do **not** need an APM agent for the beta. Two sources cover it:

- **Cloudflare edge analytics** (already in front of the box) gives request volume, status
  codes (5xx/4xx), and latency at the edge with no app changes. Set an alert on a 5xx spike
  and on a p95 latency regression. Thresholds are `<set-with-owner>` — start loose, tighten
  with real traffic.
- **App logs** carry a per-request `requestId` and structured `level` (`error`/`warn` →
  stderr). Reading these in the log sink (§4) is enough to root-cause a spike Cloudflare
  flags. AI time-to-first-token and fallback rate are visible in **Admin → Usage** without
  extra infra.

**Good enough:** you get paged when 5xx or p95 crosses a threshold, and you can open the log
sink and find the `requestId` behind it. No tracing backend required at this size.

---

## 3. AI cost alarm — the one cost that can run away

Inference/embedding spend is the **dominant variable cost** of the beta; a loop or an abuse
case can multiply it quickly. This is the alarm most worth having.

**Act**

1. **In-app budget (IMPLEMENTED, use it first).** The app evaluates budget status
   (`normal / warning / critical / hard`) and can **hard-stop** AI when the limit is hit
   (users get a generic 503; the control plane stays up). Configure the budget and
   thresholds per [`COST_CONTROL_RUNBOOK.md`](./COST_CONTROL_RUNBOOK.md). Alert on
   `warning` (**WARNING**) and `hard` (**CRITICAL**).
2. **Provider-side cap (belt and suspenders).** **HUMAN ACTION** — set a spend limit /
   billing alert in the **RunPod** dashboard so a runaway can't exceed a hard ceiling even
   if the app-side alarm is missed.
3. **HUMAN ACTION** — route both to `<cost-alert-destination>`.

**Verify** — Admin → Usage & Cost shows spend accruing; a deliberately low test threshold
fires the `warning` alert; confirm the provider-side alert exists.

---

## 4. Log sink with secret redaction (already on)

**Redaction is IMPLEMENTED** — `REDACT_KEYS` masks secret-shaped meta keys, provider
URLs/keys are never logged, and prompts/message content/connector tokens/hidden reasoning
are not logged by default (see [`OBSERVABILITY.md` logs](./OBSERVABILITY.md#logs)). You do
not add redaction; you choose where the (already-safe) logs land.

- **Floor (on the box, IMPLEMENTED):** the `json-file` driver rotates container logs
  (`web` 10m×5, `scheduler` 5m×3 — see
  [`HETZNER_DEPLOYMENT.md` §9](./HETZNER_DEPLOYMENT.md#9-logs--rotation)). This keeps the
  disk healthy but is **not** a durable, searchable archive.
- **Good enough (REQUIRES INFRA):** ship stdout/stderr to a central sink `<log-platform>`
  with retention (application logs `<30–90d>` provisional; keep audit logs longer). Any
  low-lift option works at this size — a hosted log service, or Cloudflare Logpush for edge
  logs. Confirm no provider URLs/keys ever appear (redaction miss is a **CRITICAL**
  security alert → [`SECURITY_RUNBOOK.md`](./SECURITY_RUNBOOK.md)).

---

## Where alerts go — HUMAN ACTION

Automation cannot set these. A human wires each alert to a real destination and confirms
delivery:

| Alert | Severity | Destination |
|---|---|---|
| Health `503` sustained | CRITICAL | `<on-call>` |
| 5xx spike / p95 regression | CRITICAL / WARNING | `<on-call>` |
| AI budget `warning` / `hard` | WARNING / CRITICAL | `<cost-alert-destination>` |
| Scheduler stalled (no ticks) | CRITICAL | `<on-call>` |
| Secret-in-logs (redaction miss) | CRITICAL | `<security-owner>` |

Keep the routing in one place and test each path once before launch (send a test alert).

---

## What the beta does NOT need yet

Deliberately out of scope until a [scale trigger](./MINIMUM_PRODUCTION_TOPOLOGY.md#scale-triggers)
fires — adding these now is over-engineering for 5–20 users:

- Enterprise APM / RUM agents.
- Distributed tracing (OpenTelemetry across web → DB → gateway → provider).
- A dedicated metrics TSDB + Grafana stack, custom SLO burn-rate alerting.
- Synthetic multi-step journey monitors beyond the `/api/health` probe.

When you outgrow this, promote to the full [`OBSERVABILITY.md`](./OBSERVABILITY.md)
dashboards, metrics, and retention model.
