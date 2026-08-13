# BIINA.ai — SCIM Provisioning

Provider-independent SCIM 2.0 provisioning of **Users** and **Groups** from an
enterprise IdP. SCIM automates joiner/mover/leaver so an org's directory stays in sync
without manual invites. Code: [`scim.ts`](../apps/web/src/server/enterprise/scim.ts);
schema `scim_configurations`, `organization_groups`, `organization_group_members`.
Related: [`ENTERPRISE_IDENTITY.md`](./ENTERPRISE_IDENTITY.md),
[`ENTERPRISE_RBAC.md`](./ENTERPRISE_RBAC.md).

## Gated OFF by default

SCIM is behind `SCIM_ENABLED` (default **false**) and the per-plan `scim_enabled`
entitlement. It is turned on only once an organization is configured.

## Org-scoped bearer token (hashed, shown once)

`createScimToken(organizationId, actorUserId)` mints a `scim_…` bearer token scoped to
**one** organization. Only its **SHA-256 hash** is stored (with a short prefix + last-four
for display); the plaintext is returned **once** at creation and never again. Rotating
re-issues and re-hashes.

`authenticateScim(token)` resolves the token's hash to exactly one org and refuses a
disabled config. **A token can never read or mutate another tenant** — every provisioning
call is scoped to the org the token resolved to. There is no path from an org's SCIM token
to another org's users or groups.

## User lifecycle

- **Provision** (`provisionUser`) — create or **link** a user by email (`userName`) and
  ensure an `organization_members` row for the org, marked `managedByScim`. Existing
  accounts are linked, **not duplicated**; an existing membership is updated in place.
- **Deprovision / deactivate** (`deactivateUser`) — set the membership `active=false`,
  matching by SCIM `externalId` first, then by email within the org. **This stops
  organization access only.** The person's personal BIINA account and personal data are
  **untouched** — deactivation is not deletion. `memberIsActive` then returns false and
  every access check refuses.

The invariant matches identity: SCIM manages *membership*, never *ownership* of a personal
account.

## Group lifecycle

- **Provision group** (`provisionGroup`) — create (or return existing) an
  `organization_groups` row, tenant-scoped, optionally carrying the SCIM `externalId`.
- **Set members** (`setGroupMembers`) — replace group membership; **only users who are
  members of THIS org** may be added (tenant scoping is enforced per-user). A userId from
  another tenant is silently skipped, never added.

## Endpoints

Standard SCIM 2.0 paths under `/api/scim/v2`, authenticated by the org bearer token:

- `POST /api/scim/v2/Users` — provision/link a user.
- `PATCH /api/scim/v2/Users` — activate/deactivate (deprovision).
- `POST /api/scim/v2/Groups` — provision a group.

Org-admin management of the SCIM config (token creation/rotation) is
`GET/POST /api/org/enterprise/scim` (requires `identity.read` / `identity.manage`).

## Events

`scim.token_created`, `scim.user_provisioned`, `scim.user_deactivated`,
`scim.group_provisioned` — metadata only, never the token. See
[`ENTERPRISE_AUDIT.md`](./ENTERPRISE_AUDIT.md).

## Status

- Users/Groups provisioning, org-scoped hashed token, tenant isolation, deactivate-keeps-
  personal-data — **IMPLEMENTED**, gated by `SCIM_ENABLED`.
- Full SCIM 2.0 filter/patch semantics beyond the implemented subset — **READINESS**.
