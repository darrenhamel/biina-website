# BIINA.ai — Authorization

Authorization is **server-side, always**. The UI hides controls a user can't
use, but hiding is never the control — every mutating path re-checks on the
server. Role logic lives in exactly one place: `server/auth/permissions.ts`.
There is no inline `role === 'ADMIN'` anywhere in the app.

## Two distinct authorities

Platform roles and organization roles are **separate** and never conflate.

### Platform roles (`users.role`)

| Role | Can |
|------|-----|
| `USER` | Use the product. No admin surface. |
| `ADMIN` | Manage users (status), AI control plane, plans, org suspension, view platform usage. |
| `SUPER_ADMIN` | Everything ADMIN can, **plus** change platform roles (grant/revoke ADMIN). |

Predicates: `isPlatformAdmin` (ADMIN or SUPER_ADMIN) gates user/AI/plan/usage
management; `canChangePlatformRoles` (SUPER_ADMIN only) gates the role-change
endpoint. A plain ADMIN **cannot** escalate anyone — that's the privilege
boundary the tests pin.

### Organization roles (`organization_members.role`)

| Role | Can |
|------|-----|
| `OWNER` | Everything below, plus change member roles, transfer ownership, manage billing (readiness). |
| `ADMIN` | Manage settings, invite members, remove **MEMBERs only**, view org usage. |
| `MEMBER` | Belong to the workspace; use it. No management. |

Predicates: `isOrgManager` (OWNER/ADMIN) gates settings/invite/usage;
`canChangeMemberRoles` and `canManageOrgBilling` are OWNER-only;
`canRemoveMember(actor, target)` encodes "OWNER removes anyone; ADMIN removes
MEMBERs only; MEMBER removes no one".

## Guards

Routes never hand-roll checks. They call guards that return either the
authorized context or a ready `NextResponse`:

- `server/auth/guards.ts`: `requireUser`, `requireAdmin` (isPlatformAdmin),
  `requireSuperAdmin` (canChangePlatformRoles).
- `server/org/guard.ts`: `requireOrgMember` (**404** if not a member — no
  existence leak), `requireOrgManager` (**403**), `requireOrgOwner`.

Usage is uniform:

```ts
const g = await requireOrgManager(params.slug);
if ('response' in g) return g.response;   // 401 / 403 / 404 already shaped
// g.ctx.org, g.ctx.role, g.user are verified here
```

## IDOR protection

The rule: **never trust a client-supplied id to imply access.** Access is
always derived from the authenticated user + verified membership.

- `resolveOrgContext(userId, slug)` loads the org, then verifies an **ACTIVE
  membership** for *that user*, returning `null` otherwise. A browser-supplied
  `organizationId` is never trusted; the AI chat route re-resolves membership
  from the workspace cookie on every request and 403s a suspended org.
- Org endpoints are addressed by **slug** and gated by `requireOrgMember`, so a
  non-member gets a 404 identical to "doesn't exist" — the resource's existence
  never leaks.
- Session, invitation, and member operations are all scoped by the owning id in
  the `WHERE` clause (e.g. revoke-session is `WHERE id = $1 AND user_id =
  $me`), so guessing another entity's UUID yields nothing.

## Error semantics

Domain/authorization outcomes use `AppError` (`lib/errors.ts`): `forbidden` →
403, `notFound` → 404, `conflict` → 409 (e.g. only-owner protection),
`badRequest` → 400. `handleError` maps these to safe, specific client messages.
Infra failures (`GatewayError`) return only their generic user message; internal
detail is logged, never sent.

## Where each check lives

| Concern | Enforced in |
|---------|-------------|
| Is the caller signed in / ACTIVE? | `getCurrentUser` + `requireUser` |
| Platform admin surface | `requireAdmin` / `requireSuperAdmin` |
| Org membership / management | `requireOrgMember` / `requireOrgManager` / `requireOrgOwner` |
| Which model/feature a plan allows | entitlement service (Phase 5) |
| Owner-count invariant | `server/org/members.ts` |

The authorization matrix is unit-tested in `test/permissions.test.ts`; tenant
isolation and IDOR are exercised by the live smoke checks.
