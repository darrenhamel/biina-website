# BIINA.ai — Template Library Architecture

The **Template Library** is BIINA's controlled catalog + marketplace **foundation** for
reusable prompts, agents, workflows, and research plans. Its first principle: **a
library item is DATA + validated configuration, never executable code.** Installing an
item creates a controlled local copy under the installer's own authority and **grants no
permission by itself**; executable items pass deterministic review before they can be
published; published versions are immutable. Code: `apps/web/src/server/library/`.
Companion docs: [`AGENT_LIBRARY.md`](./AGENT_LIBRARY.md),
[`WORKFLOW_LIBRARY.md`](./WORKFLOW_LIBRARY.md),
[`LIBRARY_PUBLISHING.md`](./LIBRARY_PUBLISHING.md),
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md),
[`ORGANIZATION_LIBRARY.md`](./ORGANIZATION_LIBRARY.md),
[`KIDS_TEENS_EXPERIENCE.md`](./KIDS_TEENS_EXPERIENCE.md).

## No duplicate systems

The library does not add a second runtime. An installed **AgentTemplate** becomes a
Phase 11 `AgentDefinition`; a **WorkflowTemplate** becomes a Phase 12 workflow (in
`DRAFT`); a **ResearchTemplate** configures the Phase 15 `ResearchOrchestrator`; a
**PromptTemplate** is content. Every real gate — tool policy, approvals, connector
scope, budgets, tenant isolation — is the machinery already documented in
[`AGENT_ARCHITECTURE.md`](./AGENT_ARCHITECTURE.md), [`WORKFLOWS.md`](./WORKFLOWS.md),
[`ADVANCED_RESEARCH.md`](./ADVANCED_RESEARCH.md), and
[`TOOL_POLICY.md`](./TOOL_POLICY.md). The library only distributes **configuration**.

## Item → Version → Installation

Three layers (schema: Phase 16 section of `server/db/schema.ts`; migration
[`0014_library.sql`](../apps/web/drizzle/0014_library.sql)):

- **`library_items`** — the listing: title/description (EN/AR), `itemType`, publisher
  (`BIINA` / `ORGANIZATION` / `USER`), `visibility`, `status`, `currentVersionId`,
  categories/tags, compatibility metadata mirrored from the current version
  (`supportedPersonas`, `requiredPlans`, `requiredCapabilities`, `requiredConnectors`,
  `requiredTools`, `riskLevel`), `featured` / `verified`, and aggregate signals
  (`installationCount`, `successfulRuns`, `failedRuns`, `blockedActions`, `ratingSum`,
  `ratingCount`).
- **`library_item_versions`** — an **immutable** configuration snapshot per version: the
  typed `configurationSnapshot`, a safe `manifest` (requirements/risk/hash — no
  secrets), `riskLevel`, required tools/connectors/capabilities/plans, the captured
  `validationResult`, and a `configHash`. A `version` is `DRAFT` → `PUBLISHED` →
  `SUPERSEDED`.
- **`library_installations`** — a controlled local install of a specific version:
  `installedDefinitionType` (`AGENT` / `WORKFLOW` / `PROMPT` / `RESEARCH` / `KNOWLEDGE`),
  the created `installedDefinitionId` **or** a `localConfig`, `status`, and
  `pinnedVersion`.

Additional tables: `library_categories`, `library_reviews`, `library_feedback`
(ratings — readiness), `publisher_profiles` (verified-creator readiness),
`library_org_settings`, `library_org_curation`. Nine Phase 16 enums back these.

## Item types & typed definition schemas

`LibraryItemType` has five values; each has a **strict Zod schema** in
`server/library/types.ts` (`DEFINITION_SCHEMAS`). Anything that doesn't match — arbitrary
code, unknown structures, raw URLs — is rejected before storage. Typed input fields are
declarative (`text` / `number` / `date` / `select` / `multiselect`) — **there is no
expression or code evaluation** anywhere.

| Type | Installs as | Schema highlights | Executable? |
|---|---|---|---|
| **PROMPT_TEMPLATE** | `PROMPT` (localConfig) | `promptTemplate`, `inputFields`, `outputFormat` — pure content, no tools | no |
| **AGENT_TEMPLATE** | `AGENT` (`AgentDefinition`) | `instructions`, `allowedTools`, `allowedConnectors`, `approvalPolicy`, step/tool caps | yes |
| **WORKFLOW_TEMPLATE** | `WORKFLOW` (DRAFT) | `goal`, `allowedTools`, `requiredConnectors`, `suggestedTrigger`, `approvalPolicy` | yes |
| **RESEARCH_TEMPLATE** | `RESEARCH` (localConfig) | `objective`, `depth`, `webEnabled`, `inputFields` | no |
| **KNOWLEDGE_TEMPLATE** | `KNOWLEDGE` (localConfig) | `summary`, `suggestedStructure` — **metadata only, no execution (readiness)** | no |

`isExecutableType` is true only for **AGENT_TEMPLATE** and **WORKFLOW_TEMPLATE** — the
two that create executable local definitions and therefore need `DRAFT` installs and
stronger review. See [`AGENT_LIBRARY.md`](./AGENT_LIBRARY.md) and
[`WORKFLOW_LIBRARY.md`](./WORKFLOW_LIBRARY.md).

### Risk levels

`RiskLevel` (ordered by `RISK_ORDER`): `CONTENT_ONLY` (0) → `READ_ONLY` (1) →
`WRITE_CAPABLE` (2) → `SCHEDULED_WRITE` (3) → `HIGH_RISK` (4). Risk is **derived from the
declared tool set**, never claimed by the item. `PUBLISHABLE_MAX_RISK` is
`SCHEDULED_WRITE`: **HIGH_RISK (destructive) items cannot be published in Phase 16** —
a structural rule, not a toggle. Classification lives in
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md).

## Visibility & tenant isolation

`library_visibility` (`server/library/access.ts`), always resolved server-side:

- **PRIVATE** — owner-only (`publisherUserId === viewer`).
- **ORGANIZATION** — visible only to **verified members** of the publishing org; Org A's
  items are never visible or installable by Org B.
- **BIINA_CURATED** — the platform's own catalog, visible to everyone.
- **PUBLIC** — visible only when `PUBLIC_LIBRARY_ENABLED` is on (**default off**).

Discovery (`searchItems`) builds a tenant-isolated `visibleItemsFilter` (curated + own
private + own-org + public-when-enabled), surfaces only `PUBLISHED` items, then refines
by org curation (hidden / approved-only). Details in
[`ORGANIZATION_LIBRARY.md`](./ORGANIZATION_LIBRARY.md).

## Publishing lifecycle (summary)

`library_item_status`: `DRAFT → SUBMITTED → IN_REVIEW → APPROVED → PUBLISHED`, plus
`REJECTED` / `SUSPENDED` / `ARCHIVED` / `DEPRECATED`. Deterministic validation is a hard
gate, and **executable items are never auto-published from AI review** — they require a
human/admin decision. Published versions are immutable; a change is a new version, and a
version that adds capability triggers re-review. Full flow in
[`LIBRARY_PUBLISHING.md`](./LIBRARY_PUBLISHING.md).

## Discovery, search & filters

`searchItems` (`items.ts`) is paginated (`SEARCH_PAGE_DEFAULT=24`,
`SEARCH_PAGE_MAX=50`) — the full catalog is never loaded. Filters: free-text `q`
(title/description/tags), `itemType`, `persona`, `category`, `verifiedOnly`,
`readOnlyOnly`, `freePlanOnly`, `organizationApprovedOnly`. Ordering favors featured,
then install count, then recency. `library_categories` are persona-scoped discovery
buckets (`CATEGORY_SEEDS`), from youth (`learn`, `read`, `create`, …) through study,
knowledge-work, business, and government categories.

## Recommendations — explainable & non-invasive

`buildDiscovery` (`recommend.ts`) assembles *Featured*, *For You*, and per-category
sections for the active persona. Signals are deliberately **coarse**: active persona,
plan, and language — **never private conversation content or sensitive memory**. Every
recommendation carries a plain-language reason (*"Recommended by BIINA"*, *"Matches your
experience"*, *"Included in your plan"*, *"Popular in the library"*), rendered EN/AR.

## Curated catalog

`catalog.ts` seeds `CATEGORY_SEEDS` + `CURATED_ITEMS` idempotently (keyed by slug). All
curated items are `CONTENT_ONLY` or `READ_ONLY` so they are safely publishable in Phase
16:

| Slug | Type | Notes |
|---|---|---|
| BIINA Study Assistant | PROMPT | explain-a-concept |
| BIINA Practice Questions | PROMPT | exam prep |
| BIINA Meeting Prep | PROMPT | agenda → talking points |
| BIINA Weekly Report | PROMPT | status report |
| BIINA Research Assistant | RESEARCH | cited research (web) |
| BIINA Executive Brief | RESEARCH | evidence-based brief |
| BIINA Sales Analyst | AGENT | **read-only** (gmail/drive read) |
| BIINA Weekly Sales Review | WORKFLOW | scheduled; drafts only, `ASK_EVERY_WRITE` |

A curated item that fails validation is a build error and is surfaced loudly.

## Ratings, analytics & kill switches

- **Ratings / feedback** (`library_feedback`, one per user per item) and the aggregate
  signals on items are **readiness** — schema + counters exist; a full ratings surface
  is later.
- **Admin analytics** (`admin.ts`, `GET /api/admin/library`) reports operational
  metadata only — kill-switch state, item counts by status/type, pending reviews,
  installations, recent items — **never private item content**.
- **Kill switches** (`config.ts`, env-read, never widened by item content or persona):
  `LIBRARY_ENABLED` (true), `LIBRARY_INSTALLATION_ENABLED` (true),
  `PUBLIC_LIBRARY_ENABLED` (false), `PUBLIC_CREATOR_PUBLISHING_ENABLED` (false),
  `PAID_MARKETPLACE_ENABLED` (false — **not implemented**), `EXPERIENCE_PROFILES_ENABLED`
  (true), and `LIBRARY_SUSPENDED_ITEMS` (per-item platform suspension by slug/id). Hard
  caps: `HARD_MAX_INSTALLED_AGENTS=200`, `HARD_MAX_INSTALLED_WORKFLOWS=200`; plan limits
  may be tighter, never looser.

## API surface

```
GET  /api/library                       # tenant-isolated, paginated search
POST /api/library                       # create a DRAFT item (publisher)
GET  /api/library/discover              # persona-aware Featured / For You / sections
GET  /api/library/categories            # persona-scoped discovery categories
GET  /api/library/[id]                  # item detail (access-resolved)
POST /api/library/[id]/versions         # create + validate a new DRAFT version
POST /api/library/[id]/submit           # submit a version for review
POST /api/library/[id]/install          # install current version (grants NO permission)
POST /api/library/[id]/fork             # private fork (provenance, no upstream inheritance)
POST /api/library/[id]/curation         # org curation (recommend/hide/approve)
GET  /api/library/installations         # the viewer's installs
GET|PATCH|DELETE /api/library/installations/[id]   # detail / update / uninstall
GET|PUT  /api/library/org-settings      # org library policy
GET  /api/admin/library                 # admin overview (metadata + kill switches)
GET  /api/admin/library/reviews         # review queue
POST /api/admin/library/reviews/[id]    # approve / reject / request-changes / suspend
POST /api/admin/library/[id]            # platform revocation: suspend / deprecate
```

Every privileged fact (plan, org, role, visibility) is derived server-side; a foreign or
wrong-tenant id resolves to 404 with no existence leak. Security events are `library.*`
(and `experience.changed`) — metadata only. See
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md).
