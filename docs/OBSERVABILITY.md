# BIINA.ai — Observability

Logs, metrics, traces, alerts, and dashboards for the product app. Grounded in
what exists today (`src/lib/logger.ts`, `/api/health`, admin usage) with clear
markers for what **REQUIRES INFRA**.

Owner: `<observability-owner>` · On-call: `<ops-oncall>`

---

## Logs

**Structured JSON to stdout** (`src/lib/logger.ts`). Each line:
`{ t, level, msg, ...meta }`. Levels: `debug | info | warn | error` (errors +
warns go to stderr). Request-scoped logs carry a `requestId` for correlation.

**Secret hygiene (IMPLEMENTED):**
- A redaction guard (`REDACT_KEYS`) masks meta keys matching
  `pass|secret|api key|authorization|access/refresh/session token|bearer|cookie|credential`
  → `[redacted]`.
- Token **counts** (`inputTokens`/`outputTokens`/`totalTokens`) are deliberately
  **not** redacted — they are metrics, not secrets.
- **The real rule:** don't log secrets at all. Do **not** log prompts, message
  content, connector tokens, provider base URLs/keys, or hidden model reasoning
  by default. Provider base URLs/keys are server-side only and never logged.

**Ship + retain (REQUIRES INFRA):** forward stdout/stderr to a log aggregator
(`<log-platform>`). Provisional retention: application logs `<30–90d>`; keep
**audit logs longer** (below).

### Application logs vs audit logs (keep separate)
- **Application logs** — operational events, errors, request logs. Higher volume,
  shorter retention.
- **Audit logs** — security/compliance-relevant actions (admin changes, agent
  actions, auth events, billing changes). Enterprise auditing exists in the
  product (`docs/ENTERPRISE_AUDIT.md`, `docs/AGENT_AUDITING.md`). Store in a
  separate, tamper-evident stream with **longer retention** (`<audit-retention>`,
  provisional) and tighter access.

---

## Metrics to collect

| Metric | Source today | Status |
|---|---|---|
| Request rate / error rate / latency (p50/p95/p99) | request logs / edge | **REQUIRES INFRA** (derive at aggregator) |
| HTTP 5xx / 503 rate | logs | REQUIRES INFRA |
| AI TTFT (time-to-first-token) | gateway timing | ARCH READY (emit from gateway) |
| AI tokens in/out + estimated cost | Admin → Usage & Cost | **IMPLEMENTED** (admin view) |
| AI fallback rate (`fallbackUsed`) | route decision / Admin | **IMPLEMENTED** (admin usage: fallback requests) |
| Provider health | admin `/api/ai/health` | **IMPLEMENTED** |
| DB health | `/api/health` (`select 1`) | **IMPLEMENTED** |
| Queue depth / workflow backlog | `workflowRuns` counts, tick result | ARCH READY (query/emit) |
| Workflow runs (claimed/executed/recovered/duplicates) | `workflow.tick` logs | **IMPLEMENTED** |
| Agent actions (attempted/approved/denied) | agent audit | ARCH READY |
| Billing webhook success/failure | Stripe dashboard + `billing.webhook.route_error` logs | **IMPLEMENTED (partial)** |
| Budget status (normal/warning/critical/hard) | `evaluateBudget` / Admin | **IMPLEMENTED** |
| CPU / memory / DB connections | host/DB platform | **REQUIRES INFRA** |

Expose an app metrics endpoint or push to `<metrics-platform>` (REQUIRES INFRA);
today the built-in signals are the health endpoints, structured logs, and the
admin usage dashboard.

---

## Traces / correlation

- **`requestId`** is the correlation key — propagate it through request-scoped
  logs and include it in error responses so a user report maps to log lines.
- Distributed tracing (OpenTelemetry spans across web → DB → gateway → provider)
  is **REQUIRES INFRA** — not wired today. Recommended before scale.

---

## Alerts + severities

Map alerts to incident severities (`INCIDENT_RESPONSE.md`): **INFO / WARNING /
CRITICAL**.

| Alert | Condition | Severity |
|---|---|---|
| Health down | `/api/health` `503` > `<5m>` | CRITICAL |
| DB unhealthy | `database: error` | CRITICAL |
| Error-rate spike | 5xx > `<threshold>` | CRITICAL/WARNING |
| Latency regression | p95 > `<threshold>` | WARNING |
| Budget soft warn | status `warning` | WARNING |
| Budget hard limit | status `hard` (AI refusing) | CRITICAL |
| AI fallback surge | fallback rate > `<threshold>` | WARNING |
| Provider unhealthy | admin AI health failing | WARNING/CRITICAL |
| Scheduler stalled | no `workflow.tick` for `<N min>` | CRITICAL |
| Stuck-run recoveries | recovered > `<threshold>`/tick | WARNING |
| Webhook failures | Stripe delivery failures / `billing.webhook.route_error` | CRITICAL |
| Config regression | `production-readiness` CRITICAL > 0 | CRITICAL |
| Secret in logs | secret-scan / redaction miss | CRITICAL (→ `SECURITY_RUNBOOK.md`) |

Route per `INCIDENT_RESPONSE.md` on-call. Alerting backend is **REQUIRES INFRA**
(`<alerting-platform>`).

---

## Dashboards (recommended)
1. **Service health** — health status, 5xx rate, p50/p95/p99, DB connections.
2. **AI** — requests, TTFT, tokens, estimated cost, fallback rate, provider health.
3. **Cost / budget** — daily/monthly spend vs thresholds, budget status.
4. **Automation** — tick liveness, claimed/executed/recovered/duplicates, backlog,
   agent actions.
5. **Billing** — webhook success rate, active subscriptions, failed payments.
6. **Security/audit** — admin actions, auth anomalies, agent denials.

---

## Retention (provisional)
| Stream | Provisional retention |
|---|---|
| Application logs | `<30–90 days>` |
| Audit logs | `<longer — set with compliance>` |
| Metrics | `<13 months>` for trend |
| Backups | `<db-backup-retention>` |

Mark all retention values as **provisional** until set with `<compliance-owner>`.
No jurisdiction-specific legal claims here.
