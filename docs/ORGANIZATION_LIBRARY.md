# BIINA.ai — Organization Library

How organizations publish internal items and **curate** what their members can discover
and install. Org curation is **layered on top of** the existing authorization system — it
**never grants access**, only narrows or highlights it. Code:
`apps/web/src/server/library/org.ts`, `access.ts`, `items.ts`, `installations.ts`.
Companion docs: [`LIBRARY_ARCHITECTURE.md`](./LIBRARY_ARCHITECTURE.md),
[`ORGANIZATIONS.md`](./ORGANIZATIONS.md),
[`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md),
[`LIBRARY_PUBLISHING.md`](./LIBRARY_PUBLISHING.md).

## Org-internal publishing

An organization can publish items with **`ORGANIZATION` visibility** — visible and
installable only by **verified members** of that org (`canViewItem`). Org A's items are
never visible or installable by Org B; access is resolved server-side via
`resolveOrgContextById`, and a foreign or wrong-tenant id resolves to 404 with no
existence leak. An org item is managed only by that org's `OWNER` / `ADMIN`
(`canManageItem`). Org items pass the same deterministic validation and review lifecycle
as any other item ([`LIBRARY_PUBLISHING.md`](./LIBRARY_PUBLISHING.md)); non-BIINA
publishing still depends on `PUBLIC_CREATOR_PUBLISHING_ENABLED` for the submission gate.

## Org library policy

`library_org_settings` (`getOrgLibraryPolicy`, defaults permissive) — set by org
admins via `GET|PUT /api/library/org-settings`, logged `library.org_policy_changed`:

| Setting | Default | Effect |
|---|---|---|
| `publicLibraryEnabled` | `true` | when `false`, **PUBLIC** items are dropped from discovery and blocked from install for members (`org_public_disabled`) |
| `installPolicy` | `OPEN` | `APPROVED_ONLY` restricts installs to org-approved items (+ BIINA items + the org's own) |
| `writeCapableAllowed` | `true` | when `false`, members cannot install items at or above `WRITE_CAPABLE` risk (`org_write_blocked`) |

These are enforced in `assertInstallAllowed` (at install) and `searchItems` (at
discovery) — a member never sees or installs beyond the org policy.

## Org curation (recommend / hide / approve)

`library_org_curation` (`setItemCuration` / `clearItemCuration`,
`POST /api/library/[id]/curation`, logged `library.org_curation_changed`) sets a
per-item state:

- **RECOMMENDED** — highlighted for members.
- **HIDDEN** — removed from member discovery (`orgHiddenItemIds`).
- **APPROVED** — on the org's approved list; under `APPROVED_ONLY` these (plus BIINA
  items and the org's own) are the only installable items (`orgApprovedItemIds`).

Curation is discovery/authorization **refinement**, never a grant: an approved item a
member's plan or the platform forbids is still blocked.

## Version pinning

An org can pin a curated item to a specific vetted version
(`libraryOrgCuration.pinnedVersionId`); an installation may also be `pinnedVersion`, in
which case `updateInstallation` refuses to auto-upgrade (`409 pinned`). This keeps
members on a reviewed version while a newer one is evaluated — see
[`LIBRARY_PUBLISHING.md`](./LIBRARY_PUBLISHING.md#version-pinning).

## Government CURATED_ONLY — readiness

The **Government** experience profile uses `marketplace: 'CURATED_ONLY'` so a sensitive
deployment can be restricted to platform/organization-approved items only. Combined with
`installPolicy: APPROVED_ONLY`, `writeCapableAllowed: false`, and
`publicLibraryEnabled: false`, an org can present a fully curated, write-restricted
catalog. This is a **readiness posture**: it does **not**, by itself, constitute a
sovereign or accredited-compliance deployment — dedicated sovereign/government
deployment is a later phase, and selecting the persona claims none of it
([`PERSONAS.md`](./PERSONAS.md#persona-is-not-a-security-boundary)).

## Org isolation invariants

- Personal **XOR** org ownership on every item, version, and installation; an install
  created in an org context belongs to the org, one created personally belongs to the
  user.
- Org policy and curation apply only within that org's active workspace for verified
  members; joining or leaving an org never exposes another tenant's items.
- Admin observability is metadata only; platform/org admins never see private item
  content through it.

See [`LIBRARY_SECURITY.md`](./LIBRARY_SECURITY.md) for the full tenant-isolation and
kill-switch model.
