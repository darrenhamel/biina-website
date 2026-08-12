# BIINA.ai — Workflow Templates

Ready-made **starting points** for common automations, so a user doesn't configure a
workflow from a blank page. A template is **structure only** — a goal, a suggested
trigger, and an approval posture — with **no credentials, connections, recipients, or
secrets**. Instantiating one produces an ordinary **DRAFT** workflow the user then
completes and explicitly activates. Code: `apps/web/src/server/workflows/templates.ts`.
Companion doc: [`WORKFLOWS.md`](./WORKFLOWS.md).

## What a template is (and isn't)

A `WorkflowTemplate` carries only safe, shareable fields:

- `slug`, `name`, `description`;
- a `goal` (the instruction the agent will pursue);
- a `suggestedTrigger` (schedule pattern/time/weekday or a condition check interval);
- an `approvalPolicy` (`READ_ONLY_AUTOMATIC` or `ASK_EVERY_WRITE`);
- `needsConnectors` / `needsWrite` hints so the UI can prompt for what's missing.

A template holds **no** connection ids, knowledge-base ids, recipients, tokens, or
model choices. It cannot enable an unsafe default: `needsWrite` templates suggest
`ASK_EVERY_WRITE`, and **every** instantiated workflow starts as **DRAFT** with
scheduling off until the user reviews and activates it.

## Built-in templates

`GET /api/workflows/templates` returns the built-in set:

| Slug | Name | What it does | Suggested trigger | Approval | Connectors / write |
|---|---|---|---|---|---|
| `morning-email-brief` | Morning Email Brief | Summarize important unread emails since the last run; **sends nothing**. | Daily 08:00 | `READ_ONLY_AUTOMATIC` | needs connectors · no write |
| `weekly-sales-review` | Weekly Sales Review | Summarize the sales pipeline and flag deals needing attention. | Weekly, Monday 08:00 | `READ_ONLY_AUTOMATIC` | needs connectors · no write |
| `stale-crm-opportunities` | Stale CRM Opportunities | Flag opportunities with no activity in 7 days; prepare a short list. | Condition, every 1440 min | `READ_ONLY_AUTOMATIC` | needs connectors · no write |
| `weekly-management-report` | Weekly Management Report | Generate a management report from the org knowledge base + connected sales data, ready for review before any sending. | Weekly, Friday 16:00 | `ASK_EVERY_WRITE` | needs connectors · **write** |
| `knowledge-base-digest` | Knowledge Base Digest | Summarize new documents added to a selected knowledge base this week. | Weekly, Monday 09:00 | `READ_ONLY_AUTOMATIC` | no connectors · no write |

Note how conservative the defaults are: four of five are read-only, and the one that
can write (`weekly-management-report`) prepares its output "for review before any
sending" and suggests `ASK_EVERY_WRITE` — no template auto-sends.

## Instantiation flow

Instantiating a template is a guided *create*, not a one-click activation:

1. The user picks a template (`GET /api/workflows/templates`).
2. The client pre-fills a create form from the template's goal, suggested trigger, and
   approval policy.
3. The user supplies what the template deliberately omits — the **connection(s)**,
   **knowledge base(s)**, **schedule/timezone**, **recipients**, and **approval
   policy** — and edits the goal if desired.
4. `POST /api/workflows` creates the workflow, which starts **DRAFT** (validated but
   not scheduled).
5. The user reviews the activation summary and, if satisfied, calls
   `POST /api/workflows/[id]/activate`.

Nothing is scheduled or granted by choosing a template; the same validation, plan
entitlement, and active-workflow limit apply as to any hand-built workflow.

## Organization & platform template libraries (readiness)

- **Org template library** — a shared set of org-blessed templates (e.g. an approved
  "Weekly Management Report" configured for that org's norms) is **readiness**. The
  data model supports org-owned workflows; a curated per-org template library is not
  built.
- **Platform template library** — the built-in set above is the platform library today
  (structure only). A larger, categorized, admin-curated catalog is a future extension
  on the same shape.

## Import / export (readiness)

Exporting a workflow to share its structure, or importing one, is **readiness, not
built**. When added, an export would carry **structure only** — the same safe fields a
template does — and **never** credentials, connection ids, recipients, or any secret.
Import would always land as a DRAFT for review, exactly like a template.

## Marketplace (readiness)

A community/marketplace of shareable automations (with ratings, publishing, or
payouts) is **not built** in Phase 12. If it arrives it builds on the same
structure-only, DRAFT-on-instantiate, no-secrets guarantees described here.
