# BIINA.ai — Enterprise RBAC

Fine-grained, least-privilege role-based access control for organizations, **without role
sprawl**. Phase 17 extends the coarse OWNER/ADMIN/MEMBER model (see
[`AUTHORIZATION.md`](./AUTHORIZATION.md), [`ORGANIZATIONS.md`](./ORGANIZATIONS.md)) with a
validated permission vocabulary and reusable role definitions. Code:
[`rbac.ts`](../apps/web/src/server/enterprise/rbac.ts),
[`guard.ts`](../apps/web/src/server/enterprise/guard.ts); schema
`organization_role_definitions`, `organization_members.roleDefinitionId`.

## Permission vocabulary

A permission is a `<domain>.<action>` string validated against a fixed vocabulary — **no
arbitrary permission strings**. `sanitizePermissions` drops anything unrecognized, so a
malformed or injected permission can never take effect.

- **Domains** (`PERMISSION_DOMAINS`): `members`, `groups`, `identity`, `billing`,
  `ai_models`, `knowledge`, `connectors`, `agents`, `workflows`, `research`, `library`,
  `audit`, `security`, `retention`.
- **Actions**: `read`, `manage`. `<domain>.manage` implies `<domain>.read`
  (`hasPermission`).
- **`*`** — full control, held only by an owner.

## Built-in roles

`BUILTIN_ROLES` — immutable, least-privilege, with **separation of duties** built in:

| Role | Permissions (summary) |
| --- | --- |
| `org-owner` | `*` (full) |
| `org-admin` | members/groups/connectors/agents/workflows/research/library/knowledge **manage**, ai_models **read**, audit **read** |
| `security-admin` | security **manage**, identity **manage**, audit **read**, retention **read**, members **read** |
| `ai-admin` | ai_models/agents/workflows/research **manage** |
| `knowledge-admin` | knowledge/library **manage** |
| `billing-admin` | billing **manage** (only) |
| `auditor` | audit **read** (only) |
| `member` | none |

Note the deliberate separations: **billing-admin** has *no* security, identity, knowledge,
or AI power; the **auditor** is strictly read-only; **security-admin** manages security &
identity but is **not** given billing or AI-model management. No single non-owner role
concentrates all authority.

## Custom roles

An org may define custom roles (`organization_role_definitions`) — a named permission set
validated against the same vocabulary via `sanitizePermissions`. A custom role **can never
exceed** the vocabulary, and `resolveMemberPermissions` only honors an **enabled**
definition scoped to that org. Creating custom roles requires `security.manage`
(`POST /api/org/enterprise/roles`) and is plan-gated (`custom_roles_enabled`,
`max_custom_roles`).

## Effective permissions & least privilege

`resolveMemberPermissions({ organizationId, role, roleDefinitionId })`:

- **OWNER → `*`** always. An owner can never be locked out of their own org.
- Otherwise, an assigned enabled **custom role** provides the set;
- else the **base org role** applies (`ADMIN` → org-admin set; `MEMBER` → none).

Least privilege is the default: a member with no custom role gets **only** what their base
role grants — nothing implicit.

## No self-escalation

`PUT /api/org/enterprise/members/role` assigns a role definition to a member but **rejects
assigning a role to yourself** (`self_role`, 403). A non-privileged member therefore cannot
grant themselves security/AI/owner permissions. The role definition must also belong to the
caller's org (cross-tenant role ids are refused).

## The guard

Every enterprise route calls `requireOrgPermission(req, userId, permission)`
([`guard.ts`](../apps/web/src/server/enterprise/guard.ts)), which:

- requires `ENTERPRISE_FEATURES_ENABLED`;
- resolves the caller's **active** org workspace and verified membership;
- refuses an **inactive** membership (`member_inactive`) — an SCIM-deactivated user has no
  access even mid-session;
- resolves effective permissions and asserts the required one.

Authorization is **server-side only** — never inferred from the browser.

## Role-change audit

Role assignments and role-definition changes emit metadata-only events
(`enterprise.role_assigned`, and policy changes via the security-policy store). See
[`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).

## Status

- Vocabulary, built-in + custom roles, effective resolution, no-self-escalation, the
  guard — **IMPLEMENTED**.
- Group-derived permissions (roles via SCIM groups) — **READINESS** (groups exist; the
  group→role binding is a later step).
